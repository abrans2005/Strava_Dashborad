import json
import math
import os
import threading
import time
import urllib.parse
from datetime import datetime, timedelta, timezone

import requests
from flask import Flask, render_template, request, jsonify, redirect
from stravalib import Client

app = Flask(__name__)

# 默认配置，用户可以在页面上覆盖
DEFAULT_CLIENT_ID = "117705"
DEFAULT_CLIENT_SECRET = "fb23832768654cfe5ffa53ee6eb80e349b0d6461"
PORT = int(os.environ.get("PORT", "5001"))
REDIRECT_URI = f"http://127.0.0.1:{PORT}/authorization"
SCOPE = "read,activity:read,profile:read_all"

# 活动数据缓存配置
CACHE_FILE = "activities_cache.json"
CACHE_VERSION = 2  # 缓存结构版本，字段变更时递增以触发全量同步
AUTO_SYNC_INTERVAL_SECONDS = 2 * 60 * 60  # 每 2 小时自动同步一次
SYNC_BUFFER_MINUTES = 5  # 增量同步时往回多查 5 分钟，避免漏掉离线上传的活动

# 运动员信息缓存配置（减少 Strava API 调用）
ATHLETE_CACHE_FILE = "athlete_cache.json"
ATHLETE_CACHE_TTL_SECONDS = 3600  # 1 小时


def _token_fingerprint():
    """用 access_token 后 8 位作为当前授权的指纹，用于缓存失效判断。"""
    token = session_state.get("access_token")
    return token[-8:] if token else None


def load_athlete_cache():
    """加载运动员信息缓存。"""
    try:
        with open(ATHLETE_CACHE_FILE, "r", encoding="utf-8") as f:
            cache = json.load(f)
            if not isinstance(cache, dict):
                return {}
            return cache
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_athlete_cache(cache):
    """保存运动员信息缓存。"""
    with open(ATHLETE_CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


def clear_athlete_cache():
    """清除运动员信息缓存（换账号/重新授权时调用）。"""
    try:
        os.remove(ATHLETE_CACHE_FILE)
    except FileNotFoundError:
        pass


def get_cached_athlete():
    """获取未过期的运动员信息缓存，token 变化时自动失效。"""
    cache = load_athlete_cache()
    fp = _token_fingerprint()
    if not fp or cache.get("token_fp") != fp:
        return None
    cached_at = cache.get("cached_at")
    if not cached_at or time.time() - cached_at > ATHLETE_CACHE_TTL_SECONDS:
        return None
    return cache.get("athlete")


def set_cached_athlete(athlete):
    """缓存运动员信息。"""
    save_athlete_cache({
        "token_fp": _token_fingerprint(),
        "cached_at": time.time(),
        "athlete": athlete,
        "zones": load_athlete_cache().get("zones"),
        "zones_cached_at": load_athlete_cache().get("zones_cached_at"),
    })


def get_cached_zones():
    """获取未过期的心率区间缓存，token 变化时自动失效。"""
    cache = load_athlete_cache()
    fp = _token_fingerprint()
    if not fp or cache.get("token_fp") != fp:
        return None
    cached_at = cache.get("zones_cached_at")
    if not cached_at or time.time() - cached_at > ATHLETE_CACHE_TTL_SECONDS:
        return None
    return cache.get("zones")


def set_cached_zones(zones):
    """缓存心率区间。"""
    cache = load_athlete_cache()
    cache["token_fp"] = _token_fingerprint()
    cache["zones_cached_at"] = time.time()
    cache["zones"] = zones
    save_athlete_cache(cache)


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

        # 重新授权后清掉旧的运动员信息缓存
        clear_athlete_cache()

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
    if hasattr(value, "magnitude"):
        return float(value.magnitude)
    if hasattr(value, "num"):
        return float(value.num)
    return float(value)


def to_str(value):
    """把 stravalib 的枚举/类型对象转成字符串。"""
    if value is None:
        return None
    if hasattr(value, "value"):
        return str(value.value)
    if hasattr(value, "root"):
        return str(value.root)
    return str(value)


def _to_iso(value):
    """把 datetime/stravalib 时间对象转成 ISO 字符串。"""
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, str):
        return value
    return str(value)


def _serialize_gear(gear_list):
    """把 stravalib 的装备列表序列化。"""
    if not gear_list:
        return []
    result = []
    for g in gear_list:
        result.append({
            "id": getattr(g, "id", None),
            "primary": bool(getattr(g, "primary", False)),
            "name": to_str(getattr(g, "name", None)),
            "resource_state": to_number(getattr(g, "resource_state", None)),
            "distance": to_number(getattr(g, "distance", None)),
        })
    return result


def _serialize_clubs(clubs):
    """把 stravalib 的俱乐部列表序列化。"""
    if not clubs:
        return []
    result = []
    for c in clubs:
        result.append({
            "id": getattr(c, "id", None),
            "name": to_str(getattr(c, "name", None)),
            "resource_state": to_number(getattr(c, "resource_state", None)),
            "member_count": to_number(getattr(c, "member_count", None)),
            "sport_type": to_str(getattr(c, "sport_type", None)),
            "url": getattr(c, "url", None),
        })
    return result


@app.route("/athlete")
def get_athlete():
    """使用已保存的 token 获取当前运动员信息，并做本地缓存。

    返回字段与 Strava API /v3/athlete（DetailedAthlete）保持一致。
    """
    import traceback

    client = session_state["client"]
    if not client:
        return jsonify({"error": "请先点击“连接并获取 Token”完成授权"}), 401

    cached = get_cached_athlete()
    if cached is not None:
        return jsonify(cached)

    try:
        athlete = client.get_athlete()
    except Exception as e:
        print(f"[/athlete] 调用 client.get_athlete() 失败: {e}")
        traceback.print_exc()
        return jsonify({"error": f"调用 Strava 失败: {e}"}), 500

    result = {"_fetch_errors": []}

    def safe(field, getter):
        try:
            return getter()
        except Exception as e:
            result["_fetch_errors"].append(f"{field}: {e}")
            return None

    try:
        result.update({
            "id": safe("id", lambda: athlete.id),
            "username": safe("username", lambda: to_str(getattr(athlete, "username", None))),
            "resource_state": safe("resource_state", lambda: to_number(getattr(athlete, "resource_state", None))),
            "firstname": safe("firstname", lambda: to_str(getattr(athlete, "firstname", None))),
            "lastname": safe("lastname", lambda: to_str(getattr(athlete, "lastname", None))),
            "city": safe("city", lambda: to_str(getattr(athlete, "city", None))),
            "state": safe("state", lambda: to_str(getattr(athlete, "state", None))),
            "country": safe("country", lambda: to_str(getattr(athlete, "country", None))),
            "sex": safe("sex", lambda: to_str(getattr(athlete, "sex", None))),
            "premium": safe("premium", lambda: bool(getattr(athlete, "premium", False))),
            "created_at": safe("created_at", lambda: _to_iso(getattr(athlete, "created_at", None))),
            "updated_at": safe("updated_at", lambda: _to_iso(getattr(athlete, "updated_at", None))),
            "badge_type_id": safe("badge_type_id", lambda: to_number(getattr(athlete, "badge_type_id", None))),
            "profile_medium": safe("profile_medium", lambda: getattr(athlete, "profile_medium", None)),
            "profile": safe("profile", lambda: getattr(athlete, "profile", None)),
            "friend": safe("friend", lambda: getattr(athlete, "friend", None)),
            "follower": safe("follower", lambda: getattr(athlete, "follower", None)),
            "follower_count": safe("follower_count", lambda: to_number(getattr(athlete, "follower_count", None))),
            "friend_count": safe("friend_count", lambda: to_number(getattr(athlete, "friend_count", None))),
            "mutual_friend_count": safe("mutual_friend_count", lambda: to_number(getattr(athlete, "mutual_friend_count", None))),
            "athlete_type": safe("athlete_type", lambda: to_number(getattr(athlete, "athlete_type", None))),
            "date_preference": safe("date_preference", lambda: to_str(getattr(athlete, "date_preference", None))),
            "measurement_preference": safe("measurement_preference", lambda: to_str(getattr(athlete, "measurement_preference", None))),
            "clubs": safe("clubs", lambda: _serialize_clubs(getattr(athlete, "clubs", None))),
            "ftp": safe("ftp", lambda: to_number(getattr(athlete, "ftp", None))),
            "weight": safe("weight", lambda: to_number(getattr(athlete, "weight", None))),
            "bikes": safe("bikes", lambda: _serialize_gear(getattr(athlete, "bikes", None))),
            "shoes": safe("shoes", lambda: _serialize_gear(getattr(athlete, "shoes", None))),
        })
    except Exception as e:
        print(f"[/athlete] 序列化运动员信息失败: {e}")
        traceback.print_exc()
        return jsonify({"error": f"序列化运动员信息失败: {e}"}), 500

    if not result.get("_fetch_errors"):
        result.pop("_fetch_errors", None)

    set_cached_athlete(result)
    return jsonify(result)


def _estimate_hr_zones_from_cache():
    """从本地缓存的历史活动中估算运动员的心率区间。

    取 max_heartrate 的 99 分位数作为估算最大心率，再按常见百分比划分 5 区：
    Z1: 0–60%, Z2: 60–70%, Z3: 70–80%, Z4: 80–90%, Z5: 90–100%。
    输出格式与 Strava /athlete/zones 保持一致（distribution_buckets）。
    """
    cache = load_cache()
    activities = cache.get("activities", [])
    max_hrs = [
        a["max_heartrate"]
        for a in activities
        if a.get("max_heartrate") and 30 < a["max_heartrate"] < 250
    ]
    if not max_hrs:
        return None

    max_hrs_sorted = sorted(max_hrs)
    # 用 99 分位数，避免传感器异常峰值把区间拉得太高
    idx = int(len(max_hrs_sorted) * 0.99)
    estimated_max_hr = int(max_hrs_sorted[max(0, min(idx, len(max_hrs_sorted) - 1))])

    def pct(p):
        return int(round(estimated_max_hr * p))

    return {
        "type": "heart_rate",
        "source": "estimated",
        "estimated_max_hr": estimated_max_hr,
        "custom_zones": False,
        "resource_state": 3,
        "sensor_based": False,
        "distribution_buckets": [
            {"min": 0, "max": pct(0.60), "time": None},
            {"min": pct(0.60), "max": pct(0.70), "time": None},
            {"min": pct(0.70), "max": pct(0.80), "time": None},
            {"min": pct(0.80), "max": pct(0.90), "time": None},
            {"min": pct(0.90), "max": estimated_max_hr, "time": None},
        ],
    }


@app.route("/athlete/zones")
def get_athlete_zones():
    """使用已保存的 token 直接调用 Strava /v3/athlete/zones 获取心率/功率区间。

    需要 profile:read_all scope。若 API 调用失败或没有数据，则根据本地缓存的历史
    活动数据估算心率区间并返回，保证页面不空白。
    """
    import traceback

    client = session_state["client"]
    if not client:
        return jsonify({"error": "请先点击“连接并获取 Token”完成授权"}), 401

    cached = get_cached_zones()
    # 旧缓存是对象（{heart_rate, power}），新格式是数组；旧格式直接废弃重取
    if cached is not None and isinstance(cached, list):
        return jsonify(cached)

    token = session_state.get("access_token")
    try:
        response = requests.get(
            "https://www.strava.com/api/v3/athlete/zones",
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )
        print(f"[/athlete/zones] Strava API status={response.status_code}, body preview={response.text[:200]}")
        response.raise_for_status()
        zones = response.json()
        # 保证返回的是数组
        if not isinstance(zones, list):
            zones = [zones] if zones else []

        # 如果没有心率区间数据，尝试根据本地活动估算补充
        has_hr = any(z.get("type") == "heart_rate" for z in zones)
        if not has_hr:
            estimated = _estimate_hr_zones_from_cache()
            if estimated:
                zones.append(estimated)

        set_cached_zones(zones)
        return jsonify(zones)
    except requests.exceptions.RequestException as e:
        print(f"[/athlete/zones] 调用 Strava API 失败: {e}")
        traceback.print_exc()
        # API 调用失败时，返回估算区间让页面不至于空白
        estimated = _estimate_hr_zones_from_cache()
        if estimated:
            result = [estimated]
            set_cached_zones(result)
            return jsonify(result)
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        print(f"[/athlete/zones] 处理心率区间失败: {e}")
        traceback.print_exc()
        estimated = _estimate_hr_zones_from_cache()
        if estimated:
            result = [estimated]
            set_cached_zones(result)
            return jsonify(result)
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


@app.route("/chart")
def chart():
    """为前端图表返回时间序列数据。

    请求参数:
    - year: 可选，指定年份（int），则返回该年每月的聚合指标（1-12 月）
    - metric: 可选，指标名，支持 `count`、`distance_km`、`moving_time_hours`、`elevation_gain_m`（默认 `distance_km`）

    返回值除了当前选中的指标序列外，还包含每个时间点的全量指标序列，
    方便前端 tooltip 一并展示距离、爬升等关键信息。
    """
    cache = load_cache()
    activities = cache.get("activities", [])

    year = request.args.get("year", type=int)
    metric = request.args.get("metric", "distance_km")
    if metric not in {"count", "distance_km", "moving_time_hours", "elevation_gain_m"}:
        return jsonify({"error": "unsupported metric"}), 400

    all_metrics = ["count", "distance_km", "moving_time_hours", "elevation_gain_m"]

    def has_date(a):
        return bool(a.get("start_date"))

    def per_label_acts():
        """生成 (label, activities) 列表，并保持时间升序。"""
        if year:
            return [
                (f"{year}-{m:02d}", [
                    a for a in activities
                    if has_date(a)
                    and datetime.fromisoformat(a["start_date"]).year == year
                    and datetime.fromisoformat(a["start_date"]).month == m
                ])
                for m in range(1, 13)
            ]

        groups = {}
        for a in activities:
            if not has_date(a):
                continue
            key = datetime.fromisoformat(a["start_date"]).strftime("%Y-%m")
            groups.setdefault(key, []).append(a)
        return sorted(groups.items(), key=lambda x: x[0])

    label_acts = per_label_acts()
    labels = [label for label, _ in label_acts]

    series = {m: [] for m in all_metrics}
    for _, acts in label_acts:
        agg = aggregate_activities(acts)
        for m in all_metrics:
            series[m].append(agg.get(m, 0))

    if year:
        summary = aggregate_activities([
            a for a in activities
            if has_date(a) and datetime.fromisoformat(a["start_date"]).year == year
        ])
    else:
        summary = aggregate_activities([a for a in activities if has_date(a)])

    return jsonify({
        "labels": labels,
        "metric": metric,
        "series": series,
        "summary": summary,
    })


def _filter_activities_by_date(activities, year=None, month=None):
    """按年份 / 月份过滤活动。"""
    def match(a):
        sd = a.get("start_date")
        if not sd:
            return False
        try:
            dt = datetime.fromisoformat(sd)
        except Exception:
            return False
        if year is not None and dt.year != year:
            return False
        if month is not None and dt.month != month:
            return False
        return True

    return [a for a in activities if match(a)]


@app.route("/chart/power-distribution")
def power_distribution():
    """
    返回平均功率的直方图分布，并叠加正态分布拟合曲线。
    Y 轴使用「活动时间（小时）」加权，更能反映训练负荷分布。
    支持按 year / month 过滤。
    """
    cache = load_cache()
    activities = cache.get("activities", [])

    year = request.args.get("year", type=int)
    month = request.args.get("month", type=int)
    filtered = _filter_activities_by_date(activities, year=year, month=month)

    items = [
        (a["average_watts"], a.get("moving_time", 0) or 0)
        for a in filtered
        if a.get("average_watts") is not None
    ]

    if not items:
        return jsonify({"labels": [], "hours": [], "counts": [], "curve": [], "mean": None, "std": None})

    total_time = sum(t for _, t in items)
    if total_time <= 0:
        return jsonify({"labels": [], "hours": [], "counts": [], "curve": [], "mean": None, "std": None})

    # 按活动时间加权的均值与标准差
    weighted_mean = sum(v * t for v, t in items) / total_time
    weighted_var = sum(t * (v - weighted_mean) ** 2 for v, t in items) / total_time
    std = math.sqrt(weighted_var)

    bin_width = 25  # 功率区间宽度（W）
    values_only = [v for v, _ in items]
    min_v = min(values_only)
    max_v = max(values_only)
    start = int((min_v // bin_width) * bin_width)
    end = int(((max_v // bin_width) + 1) * bin_width)
    # 至少保证 4 个区间，让图表不会太挤
    if end - start < bin_width * 4:
        end = start + bin_width * 4

    bins = list(range(start, end + bin_width, bin_width))
    bin_seconds = [0] * (len(bins) - 1)
    counts = [0] * (len(bins) - 1)

    for v, t in items:
        idx = int((v - start) // bin_width)
        if idx < 0:
            idx = 0
        elif idx >= len(bin_seconds):
            idx = len(bin_seconds) - 1
        bin_seconds[idx] += t
        counts[idx] += 1

    labels = [f"{bins[i]}-{bins[i + 1]} W" for i in range(len(bins) - 1)]
    hours = [round(s / 3600, 2) for s in bin_seconds]
    total_hours = sum(hours)

    # 正态分布拟合曲线：在每个区间中点计算 PDF，再按总时长缩放
    curve = []
    if std and std > 0:
        for i in range(len(bins) - 1):
            x = bins[i] + bin_width / 2
            pdf = (1 / (std * math.sqrt(2 * math.pi))) * math.exp(
                -((x - weighted_mean) ** 2) / (2 * weighted_var)
            )
            curve.append(round(pdf * total_hours * bin_width, 2))
    else:
        curve = [0] * len(hours)

    return jsonify({
        "labels": labels,
        "hours": hours,
        "counts": counts,
        "curve": curve,
        "mean": round(weighted_mean, 1),
        "std": round(std, 1),
    })


@app.route("/chart/hr-zones")
def hr_zones():
    """
    返回平均心率区间分布。
    Y 轴使用「活动时间（小时）」加权。
    支持按 year / month 过滤。
    """
    cache = load_cache()
    activities = cache.get("activities", [])

    year = request.args.get("year", type=int)
    month = request.args.get("month", type=int)
    filtered = _filter_activities_by_date(activities, year=year, month=month)

    items = [
        (a["average_heartrate"], a.get("moving_time", 0) or 0)
        for a in filtered
        if a.get("average_heartrate") is not None
    ]

    zones = [
        {"label": "<120 bpm", "min": 0, "max": 120},
        {"label": "120-140 bpm", "min": 120, "max": 140},
        {"label": "140-160 bpm", "min": 140, "max": 160},
        {"label": "160-180 bpm", "min": 160, "max": 180},
        {"label": ">180 bpm", "min": 180, "max": None},
    ]

    zone_seconds = [0] * len(zones)
    counts = [0] * len(zones)
    for v, t in items:
        for i, z in enumerate(zones):
            if v >= z["min"] and (z["max"] is None or v < z["max"]):
                zone_seconds[i] += t
                counts[i] += 1
                break

    return jsonify({
        "labels": [z["label"] for z in zones],
        "hours": [round(s / 3600, 2) for s in zone_seconds],
        "counts": counts,
    })


_RIDE_TYPES = {"Ride", "VirtualRide", "EBikeRide"}


def _is_ride(activity):
    """判断活动是否为骑行类。优先用 sport_type，回退到 type。"""
    return (activity.get("sport_type") or activity.get("type") or "") in _RIDE_TYPES


@app.route("/chart/top-distance")
def top_distance():
    """返回里程排名前 20 的骑行活动。"""
    cache = load_cache()
    activities = [a for a in cache.get("activities", []) if _is_ride(a)]
    top = sorted(activities, key=lambda a: a.get("distance") or 0, reverse=True)[:20]
    return jsonify([_activity_summary(a) for a in top])


@app.route("/chart/top-elevation")
def top_elevation():
    """返回爬升排名前 20 的骑行活动。"""
    cache = load_cache()
    activities = [a for a in cache.get("activities", []) if _is_ride(a)]
    top = sorted(activities, key=lambda a: a.get("total_elevation_gain") or 0, reverse=True)[:20]
    return jsonify([_activity_summary(a) for a in top])


def _activity_summary(a):
    """返回给图表用的精简活动字段。"""
    return {
        "id": a.get("id"),
        "name": a.get("name"),
        "type": a.get("type"),
        "sport_type": a.get("sport_type"),
        "start_date": a.get("start_date"),
        "distance": a.get("distance"),
        "moving_time": a.get("moving_time"),
        "elapsed_time": a.get("elapsed_time"),
        "total_elevation_gain": a.get("total_elevation_gain"),
        "average_speed": a.get("average_speed"),
        "max_heartrate": a.get("max_heartrate"),
        "average_heartrate": a.get("average_heartrate"),
        "average_watts": a.get("average_watts"),
    }


@app.route('/chart/years')
def chart_years():
    """返回活动中出现过的年份列表，降序排列。"""
    cache = load_cache()
    activities = cache.get('activities', [])
    years = set()
    for a in activities:
        sd = a.get('start_date')
        if not sd:
            continue
        try:
            y = datetime.fromisoformat(sd).year
            years.add(y)
        except Exception:
            continue

    sorted_years = sorted(years, reverse=True)
    return jsonify({'years': sorted_years})


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

    app.run(host="127.0.0.1", port=PORT, debug=True)
