import json
import os
import threading
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from flask import Flask, render_template, request, jsonify, redirect
from stravalib import Client

app = Flask(__name__)

# 默认配置，用户可以在页面上覆盖
DEFAULT_CLIENT_ID = "117705"
DEFAULT_CLIENT_SECRET = "fb23832768654cfe5ffa53ee6eb80e349b0d6461"
REDIRECT_URI = "http://127.0.0.1:5000/authorization"
SCOPE = "read,activity:read"

# 活动数据缓存配置
CACHE_FILE = "activities_cache.json"
CACHE_VERSION = 2  # 缓存结构版本，字段变更时递增以触发全量同步
AUTO_SYNC_INTERVAL_SECONDS = 2 * 60 * 60  # 每 2 小时自动同步一次
SYNC_BUFFER_MINUTES = 5  # 增量同步时往回多查 5 分钟，避免漏掉离线上传的活动

# 保存授权流程的结果
# 在本地单用户场景下用全局状态即可
session_state = {
    "client_id": None,
    "client_secret": None,
    "code": None,
    "access_token": None,
    "refresh_token": None,
    "client": None,
}


def get_credentials():
    """获取当前生效的 client_id 和 client_secret。"""
    return {
        "client_id": session_state.get("client_id") or DEFAULT_CLIENT_ID,
        "client_secret": session_state.get("client_secret") or DEFAULT_CLIENT_SECRET,
    }


def build_auth_url():
    creds = get_credentials()
    params = {
        "client_id": creds["client_id"],
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPE,
    }
    return "https://www.strava.com/oauth/mobile/authorize?" + urllib.parse.urlencode(
        params
    )


@app.route("/")
def index():
    """登录页：填写 client_id / client_secret 并发起连接。"""
    error = request.args.get("error")
    return render_template(
        "index.html",
        default_client_id=DEFAULT_CLIENT_ID,
        default_client_secret=DEFAULT_CLIENT_SECRET,
        error=error,
    )


@app.route("/configure", methods=["POST"])
def configure():
    """接收用户填写的 client_id / client_secret，保存后返回授权 URL。"""
    data = request.get_json() or {}
    client_id = (data.get("client_id") or "").strip()
    client_secret = (data.get("client_secret") or "").strip()

    if not client_id:
        return jsonify({"error": "client_id 不能为空"}), 400
    if not client_secret:
        return jsonify({"error": "client_secret 不能为空"}), 400

    session_state["client_id"] = client_id
    session_state["client_secret"] = client_secret

    return jsonify({"url": build_auth_url()})


@app.route("/authorization")
def authorization_callback():
    """Strava 授权回调：提取 code 并换取 access_token / refresh_token。"""
    code = request.args.get("code")
    error = request.args.get("error")

    if error:
        return redirect(f"/?error={urllib.parse.quote(error)}")

    if not code:
        return redirect("/?error=未获取到 code")

    session_state["code"] = code
    creds = get_credentials()

    try:
        client = Client()
        response = client.exchange_code_for_token(
            client_id=creds["client_id"],
            client_secret=creds["client_secret"],
            code=code,
        )

        access_token = response["access_token"]
        refresh_token = response["refresh_token"]

        session_state["access_token"] = access_token
        session_state["refresh_token"] = refresh_token
        session_state["client"] = client
        client.access_token = access_token

    except Exception as e:
        return redirect(f"/?error={urllib.parse.quote(str(e))}")

    return redirect("/dashboard")


@app.route("/dashboard")
def dashboard():
    """授权成功后的新页面，显示 token 并获取运动员信息。"""
    if not session_state["client"]:
        return redirect("/?error=请先完成授权")

    return render_template(
        "dashboard.html",
        client_id=session_state.get("client_id") or DEFAULT_CLIENT_ID,
        code=session_state["code"],
        access_token=session_state["access_token"],
        refresh_token=session_state["refresh_token"],
    )


def to_number(value):
    """把 stravalib 的 Quantity 或普通数值转成 float。"""
    if value is None:
        return None
    return float(value.num if hasattr(value, "num") else value)


def to_str(value):
    """把 stravalib 的枚举/类型对象转成字符串。"""
    if value is None:
        return None
    return str(value)


@app.route("/athlete")
def get_athlete():
    """使用已保存的 token 获取当前运动员信息。"""
    client = session_state["client"]
    if not client:
        return jsonify({"error": "请先点击“连接并获取 Token”完成授权"}), 401

    try:
        athlete = client.get_athlete()
        return jsonify(
            {
                "id": athlete.id,
                "firstname": athlete.firstname,
                "lastname": athlete.lastname,
                "city": getattr(athlete, "city", None),
                "country": getattr(athlete, "country", None),
            }
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ============== 活动数据缓存与增量同步 ==============

def activity_to_dict(a):
    """把 stravalib 活动对象转成可序列化的字典。"""
    return {
        "id": a.id,
        "name": to_str(a.name),
        "type": to_str(a.type),
        "sport_type": to_str(getattr(a, "sport_type", None)),
        "start_date": a.start_date.isoformat() if a.start_date else None,
        "distance": to_number(a.distance),
        "moving_time": to_number(a.moving_time),
        "elapsed_time": to_number(a.elapsed_time),
        "total_elevation_gain": to_number(a.total_elevation_gain),
        "average_speed": to_number(a.average_speed),
        "max_speed": to_number(a.max_speed),
        "average_cadence": to_number(a.average_cadence),
        "average_heartrate": to_number(a.average_heartrate),
        "max_heartrate": to_number(a.max_heartrate),
        "suffer_score": to_number(a.suffer_score),
        "has_heartrate": bool(a.has_heartrate),
        "average_watts": to_number(a.average_watts),
        "weighted_average_watts": to_number(a.weighted_average_watts),
        "max_watts": to_number(a.max_watts),
        "kilojoules": to_number(a.kilojoules),
    }


def load_cache():
    """从本地文件加载活动缓存。版本不匹配时返回空缓存以触发全量同步。"""
    try:
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            cache = json.load(f)
            if (
                not isinstance(cache, dict)
                or cache.get("version") != CACHE_VERSION
            ):
                return {"version": CACHE_VERSION, "last_sync_time": None, "activities": []}
            return cache
    except (FileNotFoundError, json.JSONDecodeError):
        return {"version": CACHE_VERSION, "last_sync_time": None, "activities": []}


def save_cache(cache):
    """把活动缓存写入本地文件。"""
    cache["version"] = CACHE_VERSION
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


def merge_activities(existing, new):
    """按 id 合并活动列表，新的覆盖旧的。"""
    by_id = {a["id"]: a for a in existing}
    for a in new:
        by_id[a["id"]] = a
    return list(by_id.values())


def sort_activities(activities):
    """按开始时间倒序排列（最新的在前面）。"""
    return sorted(
        activities,
        key=lambda a: a.get("start_date") or "",
        reverse=True,
    )


def sync_activities(force_full=False):
    """
    同步活动数据。
    - 首次调用或 force_full=True：全量同步
    - 后续调用：只同步 last_sync_time 之后新增/更新的活动
    """
    client = session_state.get("client")
    if not client:
        raise RuntimeError("未授权，无法同步活动数据")

    cache = load_cache()
    last_sync_time_str = cache.get("last_sync_time")

    if force_full or not last_sync_time_str:
        after = None
        print(f"[{datetime.now(timezone.utc)}] 开始全量同步活动数据...")
    else:
        last_sync_time = datetime.fromisoformat(last_sync_time_str)
        after = last_sync_time - timedelta(minutes=SYNC_BUFFER_MINUTES)
        print(f"[{datetime.now(timezone.utc)}] 开始增量同步，after={after.isoformat()}...")

    if after:
        activities_iterator = client.get_activities(after=after)
    else:
        activities_iterator = client.get_activities()

    new_activities = [activity_to_dict(a) for a in activities_iterator]

    merged = merge_activities(cache.get("activities", []), new_activities)
    merged = sort_activities(merged)

    cache["activities"] = merged
    cache["last_sync_time"] = datetime.now(timezone.utc).isoformat()
    save_cache(cache)

    sync_type = "全量" if after is None else "增量"
    print(f"[{datetime.now(timezone.utc)}] {sync_type}同步完成，共 {len(merged)} 条活动，本次新增/更新 {len(new_activities)} 条。")

    return merged


def aggregate_activities(activities):
    """对一组活动进行汇总统计。"""
    count = len(activities)
    distance = sum((a.get("distance") or 0) for a in activities)
    moving_time = sum((a.get("moving_time") or 0) for a in activities)
    elevation = sum((a.get("total_elevation_gain") or 0) for a in activities)

    return {
        "count": count,
        "distance_km": round(distance / 1000, 2),
        "moving_time_hours": round(moving_time / 3600, 2),
        "elevation_gain_m": round(elevation, 0),
        "avg_distance_km": round(distance / 1000 / count, 2) if count else 0,
    }


def group_activities_by(activities, key_func):
    """按 key_func 返回的 key 对活动分组，并汇总统计。"""
    groups = {}
    for a in activities:
        key = key_func(a)
        if key is None:
            continue
        groups.setdefault(key, []).append(a)

    result = []
    for key, acts in sorted(groups.items(), reverse=True):
        agg = aggregate_activities(acts)
        agg["key"] = key
        result.append(agg)
    return result


@app.route("/activities")
def get_activities():
    """获取活动列表：首次全量，后续增量，并触发每 2 小时自动同步。"""
    if not session_state.get("client"):
        return jsonify({"error": "请先点击“连接并获取 Token”完成授权"}), 401

    try:
        force_full = request.args.get("force", "0") == "1"
        activities = sync_activities(force_full=force_full)
        return jsonify(activities)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/stats")
def get_stats():
    """活动数据统计：支持按年度、月度、活动类型筛选。"""
    cache = load_cache()
    activities = cache.get("activities", [])

    year = request.args.get("year", type=int)
    month = request.args.get("month", type=int)
    activity_type = request.args.get("type")

    def match(a):
        if not a.get("start_date"):
            return False
        dt = datetime.fromisoformat(a["start_date"])
        if year and dt.year != year:
            return False
        if month and dt.month != month:
            return False
        if activity_type and a.get("type") != activity_type:
            return False
        return True

    filtered = [a for a in activities if match(a)]

    # 汇总当前筛选条件的数据
    summary = aggregate_activities(filtered)

    # 按年份统计
    by_year = group_activities_by(
        filtered, lambda a: datetime.fromisoformat(a["start_date"]).year
    )

    # 按年月统计
    by_month = group_activities_by(
        filtered,
        lambda a: datetime.fromisoformat(a["start_date"]).strftime("%Y-%m"),
    )

    # 按活动类型统计
    by_type = group_activities_by(filtered, lambda a: a.get("type") or "Unknown")

    return jsonify(
        {
            "filters": {"year": year, "month": month, "type": activity_type},
            "summary": summary,
            "by_year": by_year,
            "by_month": by_month,
            "by_type": by_type,
        }
    )


def auto_sync_loop():
    """后台线程：每隔 AUTO_SYNC_INTERVAL_SECONDS 执行一次增量同步。"""
    while True:
        time.sleep(AUTO_SYNC_INTERVAL_SECONDS)
        try:
            if session_state.get("client"):
                sync_activities()
        except Exception as e:
            print(f"[{datetime.now(timezone.utc)}] 自动同步失败: {e}")


if __name__ == "__main__":
    # 启动自动同步后台线程
    sync_thread = threading.Thread(target=auto_sync_loop, daemon=True)
    sync_thread.start()

    app.run(host="127.0.0.1", port=5000, debug=True)
