import json
import math
import os
import secrets
import tempfile
import threading
import time
import urllib.parse
from datetime import datetime, timedelta, timezone

import requests
from flask import Flask, render_template, request, jsonify, redirect

# stravalib 在 Client() 缺少 STRAVA_CLIENT_ID/SECRET 环境变量时会打印 token 刷新警告；
# 本项目自己管理授权流程（见 /authorization），无需 stravalib 自动刷新，直接静音该警告。
os.environ.setdefault("SILENCE_TOKEN_WARNINGS", "true")

from stravalib import Client

app = Flask(__name__)

DEFAULT_CLIENT_ID = os.environ.get("STRAVA_CLIENT_ID", "").strip()
DEFAULT_CLIENT_SECRET = os.environ.get("STRAVA_CLIENT_SECRET", "").strip()
PORT = int(os.environ.get("PORT", "5001"))
REDIRECT_URI = f"http://127.0.0.1:{PORT}/authorization"
SCOPE = "read,activity:read,profile:read_all"
TOKEN_REFRESH_BUFFER_SECONDS = 60

CACHE_ROOT_DIR = "cache"
ACTIVITY_CACHE_FILENAME = "activities.json"
ATHLETE_CACHE_FILENAME = "athlete.json"
CACHE_VERSION = 4
AUTO_SYNC_INTERVAL_SECONDS = 2 * 60 * 60
FULL_SYNC_INTERVAL_SECONDS = 24 * 60 * 60
SYNC_BUFFER_MINUTES = 5
ATHLETE_CACHE_TTL_SECONDS = 3600

_cache_lock = threading.RLock()
_sync_lock = threading.Lock()
_token_lock = threading.RLock()

# 本地单用户场景下使用全局状态；敏感值只保存在当前进程内。
session_state = {
    "client_id": None,
    "client_secret": None,
    "oauth_state": None,
    "access_token": None,
    "refresh_token": None,
    "expires_at": None,
    "athlete_id": None,
    "client": None,
}


def get_credentials():
    """获取当前生效的 client_id 和 client_secret。"""
    return {
        "client_id": session_state.get("client_id") or DEFAULT_CLIENT_ID,
        "client_secret": session_state.get("client_secret") or DEFAULT_CLIENT_SECRET,
    }


def _current_athlete_id():
    athlete_id = session_state.get("athlete_id")
    return str(athlete_id) if athlete_id is not None else None


def _cache_file(filename):
    athlete_id = _current_athlete_id()
    if not athlete_id:
        return None
    return os.path.join(CACHE_ROOT_DIR, athlete_id, filename)


def _read_json(path):
    if not path:
        return None
    with _cache_lock:
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return None


def _atomic_write_json(path, data):
    if not path:
        raise RuntimeError("尚未确定运动员身份，无法写入缓存")
    with _cache_lock:
        directory = os.path.dirname(path)
        os.makedirs(directory, exist_ok=True)
        fd, temp_path = tempfile.mkstemp(prefix=".tmp-", suffix=".json", dir=directory)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
                f.flush()
                os.fsync(f.fileno())
            os.replace(temp_path, path)
        except Exception:
            try:
                os.remove(temp_path)
            except FileNotFoundError:
                pass
            raise


def _store_token_response(response):
    session_state["access_token"] = response["access_token"]
    session_state["refresh_token"] = (
        response.get("refresh_token") or session_state.get("refresh_token")
    )
    expires_at = response.get("expires_at")
    session_state["expires_at"] = int(expires_at) if expires_at is not None else None

    athlete = response.get("athlete") or {}
    if athlete.get("id") is not None:
        session_state["athlete_id"] = str(athlete["id"])

    client = session_state.get("client")
    if client:
        client.access_token = session_state["access_token"]


def get_valid_access_token():
    """返回有效 Token，并在临近过期时用 Refresh Token 自动刷新。"""
    with _token_lock:
        token = session_state.get("access_token")
        if not token:
            raise RuntimeError("未授权")

        expires_at = session_state.get("expires_at")
        if expires_at and time.time() >= expires_at - TOKEN_REFRESH_BUFFER_SECONDS:
            refresh_token = session_state.get("refresh_token")
            if not refresh_token:
                raise RuntimeError("Access Token 已过期，且没有 Refresh Token")
            creds = get_credentials()
            response = requests.post(
                "https://www.strava.com/api/v3/oauth/token",
                data={
                    "client_id": creds["client_id"],
                    "client_secret": creds["client_secret"],
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                },
                timeout=30,
            )
            response.raise_for_status()
            _store_token_response(response.json())

        return session_state["access_token"]


def _ensure_athlete_identity():
    athlete_id = _current_athlete_id()
    if athlete_id:
        return athlete_id

    client = session_state.get("client")
    if not client:
        raise RuntimeError("未授权")
    get_valid_access_token()
    athlete = client.get_athlete()
    session_state["athlete_id"] = str(athlete.id)
    return session_state["athlete_id"]


def load_athlete_cache():
    """加载当前运动员的信息缓存。"""
    cache = _read_json(_cache_file(ATHLETE_CACHE_FILENAME))
    if not isinstance(cache, dict):
        return {}
    if cache.get("athlete_id") != _current_athlete_id():
        return {}
    return cache


def save_athlete_cache(cache):
    cache["athlete_id"] = _current_athlete_id()
    _atomic_write_json(_cache_file(ATHLETE_CACHE_FILENAME), cache)


def clear_athlete_cache():
    """清除当前运动员的信息缓存。"""
    path = _cache_file(ATHLETE_CACHE_FILENAME)
    if not path:
        return
    with _cache_lock:
        try:
            os.remove(path)
        except FileNotFoundError:
            pass


def get_cached_athlete():
    cache = load_athlete_cache()
    cached_at = cache.get("cached_at")
    if not cached_at or time.time() - cached_at > ATHLETE_CACHE_TTL_SECONDS:
        return None
    return cache.get("athlete")


def set_cached_athlete(athlete):
    with _cache_lock:
        cache = load_athlete_cache()
        cache.update({
            "cached_at": time.time(),
            "athlete": athlete,
        })
        save_athlete_cache(cache)


def get_cached_zones():
    cache = load_athlete_cache()
    cached_at = cache.get("zones_cached_at")
    if not cached_at or time.time() - cached_at > ATHLETE_CACHE_TTL_SECONDS:
        return None
    return cache.get("zones")


def set_cached_zones(zones):
    with _cache_lock:
        cache = load_athlete_cache()
        cache["zones_cached_at"] = time.time()
        cache["zones"] = zones
        save_athlete_cache(cache)


def build_auth_url():
    creds = get_credentials()
    state = secrets.token_urlsafe(32)
    session_state["oauth_state"] = state
    params = {
        "client_id": creds["client_id"],
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPE,
        "state": state,
    }
    return "https://www.strava.com/oauth/mobile/authorize?" + urllib.parse.urlencode(
        params
    )


@app.route("/")
def index():
    error = request.args.get("error")
    return render_template(
        "index.html",
        default_client_id=DEFAULT_CLIENT_ID,
        has_default_client_secret=bool(DEFAULT_CLIENT_SECRET),
        error=error,
    )


@app.route("/configure", methods=["POST"])
def configure():
    data = request.get_json() or {}
    client_id = (data.get("client_id") or "").strip() or DEFAULT_CLIENT_ID
    client_secret = (data.get("client_secret") or "").strip() or DEFAULT_CLIENT_SECRET

    if not client_id:
        return jsonify({"error": "client_id 不能为空"}), 400
    if not client_secret:
        return jsonify({"error": "请填写 client_secret，或设置 STRAVA_CLIENT_SECRET 环境变量"}), 400

    session_state["client_id"] = client_id
    session_state["client_secret"] = client_secret

    return jsonify({"url": build_auth_url()})


@app.route("/authorization")
def authorization_callback():
    """校验 OAuth state，并用一次性 code 换取 Token。"""
    expected_state = session_state.get("oauth_state")
    returned_state = request.args.get("state")
    if (
        not expected_state
        or not returned_state
        or not secrets.compare_digest(expected_state, returned_state)
    ):
        return redirect("/?error=OAuth state 校验失败，请重新发起授权")
    session_state["oauth_state"] = None

    error = request.args.get("error")
    if error:
        return redirect(f"/?error={urllib.parse.quote(error)}")

    code = request.args.get("code")
    if not code:
        return redirect("/?error=未获取到 code")

    creds = get_credentials()
    try:
        client = Client()
        response = client.exchange_code_for_token(
            client_id=creds["client_id"],
            client_secret=creds["client_secret"],
            code=code,
        )
        session_state["client"] = client
        session_state["athlete_id"] = None
        _store_token_response(response)
        _ensure_athlete_identity()
        clear_athlete_cache()
    except Exception as e:
        return redirect(f"/?error={urllib.parse.quote(str(e))}")

    return redirect("/dashboard")


@app.route("/dashboard")
def dashboard():
    if not session_state["client"]:
        return redirect("/?error=请先完成授权")
    return render_template("dashboard.html")


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
        _ensure_athlete_identity()
        get_valid_access_token()
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

    _ensure_athlete_identity()
    cached = get_cached_zones()
    # 旧缓存是对象（{heart_rate, power}），新格式是数组；旧格式直接废弃重取
    if cached is not None and isinstance(cached, list):
        return jsonify(cached)

    try:
        response = _strava_get("https://www.strava.com/api/v3/athlete/zones")
        print(f"[/athlete/zones] Strava API status={response.status_code}")
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


# ============== 活动流数据（Streams）缓存与分析 ==============

STREAMS_CACHE_TTL_SECONDS = 24 * 60 * 60  # 24 小时


def _streams_cache_path(activity_id):
    return _cache_file(os.path.join("streams", f"{activity_id}.json"))


def load_streams_cache(activity_id):
    """加载当前运动员某个活动的流数据缓存。"""
    cache = _read_json(_streams_cache_path(activity_id))
    if not isinstance(cache, dict):
        return None
    if cache.get("athlete_id") != _current_athlete_id():
        return None
    cached_at = cache.get("cached_at")
    if not cached_at or time.time() - cached_at > STREAMS_CACHE_TTL_SECONDS:
        return None
    return cache.get("data")


def save_streams_cache(activity_id, data):
    cache = {
        "athlete_id": _current_athlete_id(),
        "cached_at": time.time(),
        "data": data,
    }
    _atomic_write_json(_streams_cache_path(activity_id), cache)


def _moving_average(data, window=7):
    """对一维数组做简单移动平均平滑。"""
    if not data:
        return []
    n = len(data)
    if n <= window:
        return data[:]
    half = window // 2
    result = []
    for i in range(n):
        lo = max(0, i - half)
        hi = min(n, i + half + 1)
        vals = [data[j] for j in range(lo, hi) if data[j] is not None]
        result.append(sum(vals) / len(vals) if vals else None)
    return result


def _compute_grade(distance, altitude):
    """根据距离（米）和海拔（米）计算坡度百分比。"""
    n = len(distance)
    if n != len(altitude) or n < 2:
        return [0.0] * n
    grades = [0.0]
    for i in range(1, n):
        d = distance[i] - distance[i - 1]
        h = altitude[i] - altitude[i - 1]
        if d and d > 0:
            grades.append((h / d) * 100)
        else:
            grades.append(grades[-1])
    return grades


def _downsample(data_lists, max_points=600):
    """按索引均匀降采样多组等长序列。"""
    n = len(data_lists[0]) if data_lists else 0
    if n <= max_points:
        return data_lists
    step = n / max_points
    result = [[] for _ in data_lists]
    for i in range(max_points):
        idx = int(i * step)
        if idx >= n:
            idx = n - 1
        for j, lst in enumerate(data_lists):
            result[j].append(lst[idx])
    return result


def _hr_zone_label(hr, hr_zones):
    """根据心率区间配置判断某心率属于哪个区间，返回 0-based 索引。"""
    if hr is None or hr_zones is None or not hr_zones:
        return None
    for i, z in enumerate(hr_zones):
        min_hr = z.get("min")
        max_hr = z.get("max")
        if min_hr is None:
            min_hr = 0
        if max_hr is None or max_hr == -1:
            # 最后一个区间无上界
            if hr >= min_hr:
                return i
        elif min_hr <= hr < max_hr:
            return i
    return len(hr_zones) - 1


def _get_hr_zones_from_athlete():
    """从运动员缓存或默认获取心率区间 buckets。"""
    cached = get_cached_zones()
    if cached and isinstance(cached, list):
        hr_zone = next((z for z in cached if z.get("type") == "heart_rate"), None)
        if hr_zone and hr_zone.get("distribution_buckets"):
            return hr_zone["distribution_buckets"]
    # 默认五区（基于 190 最大心率估算）
    return [
        {"min": 0, "max": 114},
        {"min": 114, "max": 133},
        {"min": 133, "max": 152},
        {"min": 152, "max": 171},
        {"min": 171, "max": -1},
    ]


def _analyze_hr_zones(heartrate, time_stream, hr_zones):
    """统计心率在各区间的累计时长（秒）和占比。"""
    n = len(heartrate)
    if n == 0 or not hr_zones:
        return []
    # 如果 time_stream 可用，用相邻点时间差；否则默认每点 1 秒
    has_time = time_stream and len(time_stream) == n
    zone_seconds = [0.0] * len(hr_zones)
    total = 0.0
    for i in range(n):
        if heartrate[i] is None:
            continue
        zone_idx = _hr_zone_label(heartrate[i], hr_zones)
        if zone_idx is None:
            continue
        if has_time and i > 0:
            dt = time_stream[i] - time_stream[i - 1]
            if dt is None or dt < 0 or dt > 30:
                dt = 1
        else:
            dt = 1
        zone_seconds[zone_idx] += dt
        total += dt
    result = []
    for i, seconds in enumerate(zone_seconds):
        z = hr_zones[i]
        max_hr = z.get("max")
        label = f"Z{i + 1}: {z.get('min', 0)}-{max_hr if max_hr and max_hr != -1 else '+'} bpm"
        result.append({
            "zone": i + 1,
            "label": label,
            "seconds": round(seconds, 1),
            "hours": round(seconds / 3600, 2),
            "pct": round(seconds / total * 100, 1) if total > 0 else 0,
        })
    return result


def _find_climb_segments(distance_km, grade):
    """找出坡度 > 5% 的连续爬坡段。"""
    n = len(distance_km)
    if n != len(grade):
        return []
    segments = []
    in_climb = False
    start_km = 0
    for i in range(n):
        if grade[i] is not None and grade[i] > 5:
            if not in_climb:
                in_climb = True
                start_km = distance_km[i]
        else:
            if in_climb:
                end_km = distance_km[max(0, i - 1)]
                segments.append({
                    "start_km": round(start_km, 2),
                    "end_km": round(end_km, 2),
                    "distance_km": round(end_km - start_km, 2),
                })
                in_climb = False
    if in_climb:
        segments.append({
            "start_km": round(start_km, 2),
            "end_km": round(distance_km[-1], 2),
            "distance_km": round(distance_km[-1] - start_km, 2),
        })
    return segments


@app.route("/activities/<int:activity_id>/streams")
def get_activity_streams(activity_id):
    """获取单个活动的流数据，做清洗、平滑、聚合后返回给前端。

    请求 Strava keys: distance,altitude,heartrate,velocity_smooth,watts,
    grade_smooth,time,latlng。
    """
    import traceback

    if not session_state.get("client"):
        return jsonify({"error": "请先点击“连接并获取 Token”完成授权"}), 401

    _ensure_athlete_identity()
    cached = load_streams_cache(activity_id)
    if cached is not None:
        return jsonify(cached)

    keys = "distance,altitude,heartrate,velocity_smooth,watts,grade_smooth,time,latlng"
    url = f"https://www.strava.com/api/v3/activities/{activity_id}/streams"
    try:
        response = _strava_get(
            url,
            params={"keys": keys, "key_by_type": "true"},
            timeout=60,
        )
        print(f"[/activities/{activity_id}/streams] Strava API status={response.status_code}")
        response.raise_for_status()
        raw = response.json()
    except requests.exceptions.RequestException as e:
        print(f"[/activities/{activity_id}/streams] 调用失败: {e}")
        traceback.print_exc()
        return jsonify({"error": f"调用 Strava 失败: {e}"}), 500

    # raw 可能是数组或对象（key_by_type=true 时为对象）
    streams = {}
    if isinstance(raw, dict):
        streams = raw
    elif isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict) and "type" in item:
                streams[item["type"]] = item

    distance_raw = streams.get("distance", {}).get("data") if isinstance(streams.get("distance"), dict) else []
    altitude_raw = streams.get("altitude", {}).get("data") if isinstance(streams.get("altitude"), dict) else []
    heartrate_raw = streams.get("heartrate", {}).get("data") if isinstance(streams.get("heartrate"), dict) else []
    velocity_raw = streams.get("velocity_smooth", {}).get("data") if isinstance(streams.get("velocity_smooth"), dict) else []
    watts_raw = streams.get("watts", {}).get("data") if isinstance(streams.get("watts"), dict) else []
    grade_raw = streams.get("grade_smooth", {}).get("data") if isinstance(streams.get("grade_smooth"), dict) else []
    time_raw = streams.get("time", {}).get("data") if isinstance(streams.get("time"), dict) else []

    n = len(distance_raw) if distance_raw else 0
    if n == 0:
        return jsonify({"error": "Strava 返回的流数据为空"}), 404

    # 对齐长度（某些流序列可能比 distance 短）
    def align(seq):
        if not seq:
            return [None] * n
        if len(seq) < n:
            return seq + [None] * (n - len(seq))
        return seq[:n]

    distance = align(distance_raw)
    altitude = align(altitude_raw)
    heartrate = align(heartrate_raw)
    velocity = align(velocity_raw)
    watts = align(watts_raw)
    grade = align(grade_raw)
    time_stream = align(time_raw)

    # 清洗 None 点：如果某个索引 distance 为 None，则整行丢弃
    valid_indices = [i for i in range(n) if distance[i] is not None]
    if not valid_indices:
        return jsonify({"error": "流数据无效"}), 500

    distance = [distance[i] for i in valid_indices]
    altitude = [altitude[i] for i in valid_indices]
    heartrate = [heartrate[i] for i in valid_indices]
    velocity = [velocity[i] for i in valid_indices]
    watts = [watts[i] for i in valid_indices]
    grade = [grade[i] for i in valid_indices]
    time_stream = [time_stream[i] for i in valid_indices]

    distance_km = [round(d / 1000, 3) for d in distance]
    velocity_kmh = [round(v * 3.6, 2) if v is not None else None for v in velocity]

    # 若 Strava 未返回坡度，则根据海拔-距离计算
    if not any(g is not None for g in grade) and any(a is not None for a in altitude):
        grade = _compute_grade(distance, altitude)

    # 对速度和功率做平滑
    velocity_smooth = _moving_average(velocity_kmh, window=7)
    watts_smooth = _moving_average(watts, window=7)

    # 心率区间统计
    hr_zones = _get_hr_zones_from_athlete()
    hr_zone_stats = _analyze_hr_zones(heartrate, time_stream, hr_zones)

    # 爬坡段
    climb_segments = _find_climb_segments(distance_km, grade)

    # 统计值
    def avg(seq):
        vals = [v for v in seq if v is not None]
        return round(sum(vals) / len(vals), 1) if vals else None

    result = {
        "activity_id": activity_id,
        "distance_km": distance_km,
        "altitude": altitude,
        "heartrate": heartrate,
        "velocity_kmh": velocity_smooth,
        "watts": watts_smooth,
        "grade": grade,
        "time": time_stream,
        "summary": {
            "avg_heartrate": avg(heartrate),
            "avg_velocity_kmh": avg(velocity_smooth),
            "avg_watts": avg(watts_smooth),
            "max_altitude": round(max([a for a in altitude if a is not None]), 1) if any(a is not None for a in altitude) else None,
            "min_altitude": round(min([a for a in altitude if a is not None]), 1) if any(a is not None for a in altitude) else None,
            "climb_segments": climb_segments,
        },
        "hr_zone_stats": hr_zone_stats,
        "has_hr": any(h is not None for h in heartrate),
        "has_watts": any(w is not None for w in watts),
    }

    # 降采样：如果点太多，按索引均匀采样
    all_series = [result["distance_km"], result["altitude"], result["heartrate"], result["velocity_kmh"], result["watts"], result["grade"], result["time"]]
    sampled = _downsample(all_series, max_points=600)
    result["distance_km"] = sampled[0]
    result["altitude"] = sampled[1]
    result["heartrate"] = sampled[2]
    result["velocity_kmh"] = sampled[3]
    result["watts"] = sampled[4]
    result["grade"] = sampled[5]
    result["time"] = sampled[6]
    # 降采样后爬坡段不必重新计算，使用原始统计即可

    save_streams_cache(activity_id, result)
    return jsonify(result)


# ============== 活动数据缓存与增量同步 ==============

def activity_to_dict(a):
    """把 stravalib 活动对象转成可序列化的字典。"""
    return {
        "id": a.id,
        "name": to_str(a.name),
        "type": to_str(a.type),
        "sport_type": to_str(getattr(a, "sport_type", None)),
        "start_date": _to_iso(a.start_date),
        "start_date_local": _to_iso(getattr(a, "start_date_local", None)),
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


def _activity_local_datetime(activity):
    """优先使用 Strava 本地开始时间，旧缓存回退到 UTC 转服务器本地时间。"""
    for field in ("start_date_local", "start_date"):
        value = activity.get(field)
        if not value:
            continue
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except (AttributeError, TypeError, ValueError):
            continue
        if field == "start_date" and dt.tzinfo:
            dt = dt.astimezone()
        return dt.replace(tzinfo=None)
    return None


def _empty_activity_cache():
    return {
        "version": CACHE_VERSION,
        "athlete_id": _current_athlete_id(),
        "last_sync_time": None,
        "last_full_sync_time": None,
        "activities": [],
    }


def load_cache():
    """加载当前运动员的活动缓存，其他账号的数据不可见。"""
    cache = _read_json(_cache_file(ACTIVITY_CACHE_FILENAME))
    if not isinstance(cache, dict) or cache.get("athlete_id") != _current_athlete_id():
        return _empty_activity_cache()
    if cache.get("version") != CACHE_VERSION:
        # 版本升级后保留旧数据先用，同时标记需要一次全量同步来补齐新字段。
        cache["needs_full_sync"] = True
    return cache


def save_cache(cache):
    cache["version"] = CACHE_VERSION
    cache["athlete_id"] = _current_athlete_id()
    _atomic_write_json(_cache_file(ACTIVITY_CACHE_FILENAME), cache)


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
    """增量同步近期活动，并每天全量对账上传、修改和删除。"""
    with _sync_lock:
        client = session_state.get("client")
        if not client:
            raise RuntimeError("未授权，无法同步活动数据")

        get_valid_access_token()
        athlete_id = _ensure_athlete_identity()
        cache = load_cache()
        now = datetime.now(timezone.utc)

        last_sync_time = None
        last_full_sync_time = None
        try:
            if cache.get("last_sync_time"):
                last_sync_time = datetime.fromisoformat(cache["last_sync_time"])
            if cache.get("last_full_sync_time"):
                last_full_sync_time = datetime.fromisoformat(cache["last_full_sync_time"])
        except (TypeError, ValueError):
            last_sync_time = None
            last_full_sync_time = None

        full_sync = (
            force_full
            or last_sync_time is None
            or last_full_sync_time is None
            or cache.get("needs_full_sync")
            or now - last_full_sync_time >= timedelta(seconds=FULL_SYNC_INTERVAL_SECONDS)
        )

        if full_sync:
            after = None
            print(f"[{now}] 开始全量同步运动员 {athlete_id} 的活动数据...")
        else:
            after = last_sync_time - timedelta(minutes=SYNC_BUFFER_MINUTES)
            print(f"[{now}] 开始增量同步，after={after.isoformat()}...")

        if after:
            activities_iterator = client.get_activities(after=after)
        else:
            activities_iterator = client.get_activities()
        new_activities = [activity_to_dict(a) for a in activities_iterator]

        if _current_athlete_id() != athlete_id:
            raise RuntimeError("授权账号已切换，本次同步结果已丢弃")

        if full_sync:
            merged = sort_activities(new_activities)
        else:
            merged = sort_activities(
                merge_activities(cache.get("activities", []), new_activities)
            )

        cache["activities"] = merged
        cache["last_sync_time"] = now.isoformat()
        if full_sync:
            cache["last_full_sync_time"] = now.isoformat()
        cache.pop("needs_full_sync", None)
        save_cache(cache)

        sync_type = "全量" if full_sync else "增量"
        print(f"[{now}] {sync_type}同步完成，共 {len(merged)} 条活动，本次新增/更新 {len(new_activities)} 条。")
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


def _filter_activities_by_date(activities, year=None, month=None):
    """按活动的本地开始年份 / 月份过滤。"""
    filtered = []
    for activity in activities:
        dt = _activity_local_datetime(activity)
        if dt is None:
            continue
        if year is not None and dt.year != year:
            continue
        if month is not None and dt.month != month:
            continue
        filtered.append(activity)
    return filtered


def _parse_int_arg(name):
    """读取整数查询参数：空值视为未提供，非法值返回错误信息。"""
    raw = request.args.get(name)
    if raw is None or str(raw).strip() == "":
        return None, None
    try:
        return int(str(raw).strip()), None
    except ValueError:
        return None, f"{name} 必须是整数"


def _parse_year_month_args():
    """解析并校验 year / month 查询参数，返回 (year, month, error)。"""
    year, error = _parse_int_arg("year")
    if error:
        return None, None, error
    month, error = _parse_int_arg("month")
    if error:
        return None, None, error
    if year is not None and not 1970 <= year <= 2999:
        return None, None, "year 超出合理范围"
    if month is not None and not 1 <= month <= 12:
        return None, None, "month 必须在 1-12 之间"
    return year, month, None


@app.route("/stats")
def get_stats():
    """活动数据统计：支持按本地年度、月度、活动类型筛选。"""
    cache = load_cache()
    activities = cache.get("activities", [])

    year, month, error = _parse_year_month_args()
    if error:
        return jsonify({"error": error}), 400
    activity_type = request.args.get("type")

    filtered = _filter_activities_by_date(activities, year=year, month=month)
    if activity_type:
        filtered = [a for a in filtered if a.get("type") == activity_type]

    summary = aggregate_activities(filtered)
    by_year = group_activities_by(
        filtered, lambda a: _activity_local_datetime(a).year
    )
    by_month = group_activities_by(
        filtered, lambda a: _activity_local_datetime(a).strftime("%Y-%m")
    )
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
    """按本地年月返回聚合指标，并让 year / month 同时作用于图表和汇总。"""
    cache = load_cache()
    activities = cache.get("activities", [])

    year, month, error = _parse_year_month_args()
    if error:
        return jsonify({"error": error}), 400
    metric = request.args.get("metric", "distance_km")
    if metric not in {"count", "distance_km", "moving_time_hours", "elevation_gain_m"}:
        return jsonify({"error": "unsupported metric"}), 400

    all_metrics = ["count", "distance_km", "moving_time_hours", "elevation_gain_m"]
    filtered = _filter_activities_by_date(activities, year=year, month=month)

    groups = {}
    for activity in filtered:
        key = _activity_local_datetime(activity).strftime("%Y-%m")
        groups.setdefault(key, []).append(activity)

    if year is not None and month is None:
        label_acts = [
            (f"{year}-{m:02d}", groups.get(f"{year}-{m:02d}", []))
            for m in range(1, 13)
        ]
    else:
        label_acts = sorted(groups.items())

    labels = [label for label, _ in label_acts]
    series = {m: [] for m in all_metrics}
    for _, acts in label_acts:
        agg = aggregate_activities(acts)
        for m in all_metrics:
            series[m].append(agg.get(m, 0))

    return jsonify({
        "filters": {"year": year, "month": month},
        "labels": labels,
        "metric": metric,
        "series": series,
        "summary": aggregate_activities(filtered),
    })


@app.route("/chart/power-distribution")
def power_distribution():
    """
    返回平均功率的直方图分布，并叠加正态分布拟合曲线。
    Y 轴使用「活动时间（小时）」加权，更能反映训练负荷分布。
    支持按 year / month 过滤。
    """
    cache = load_cache()
    activities = cache.get("activities", [])

    year, month, error = _parse_year_month_args()
    if error:
        return jsonify({"error": error}), 400
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

    year, month, error = _parse_year_month_args()
    if error:
        return jsonify({"error": error}), 400
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
    """返回里程排名前 20 的骑行活动，支持按 year / month 过滤。"""
    year, month, error = _parse_year_month_args()
    if error:
        return jsonify({"error": error}), 400

    cache = load_cache()
    activities = _filter_activities_by_date(
        cache.get("activities", []), year=year, month=month
    )
    rides = [a for a in activities if _is_ride(a)]
    top = sorted(rides, key=lambda a: a.get("distance") or 0, reverse=True)[:20]
    return jsonify([_activity_summary(a) for a in top])


@app.route("/chart/top-elevation")
def top_elevation():
    """返回爬升排名前 20 的骑行活动，支持按 year / month 过滤。"""
    year, month, error = _parse_year_month_args()
    if error:
        return jsonify({"error": error}), 400

    cache = load_cache()
    activities = _filter_activities_by_date(
        cache.get("activities", []), year=year, month=month
    )
    rides = [a for a in activities if _is_ride(a)]
    top = sorted(rides, key=lambda a: a.get("total_elevation_gain") or 0, reverse=True)[:20]
    return jsonify([_activity_summary(a) for a in top])


def _activity_summary(a):
    """返回给图表用的精简活动字段。"""
    return {
        "id": a.get("id"),
        "name": a.get("name"),
        "type": a.get("type"),
        "sport_type": a.get("sport_type"),
        "start_date": a.get("start_date"),
        "start_date_local": a.get("start_date_local"),
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
    """按本地开始时间返回活动年份列表，降序排列。"""
    cache = load_cache()
    activities = cache.get('activities', [])
    years = {
        dt.year
        for activity in activities
        if (dt := _activity_local_datetime(activity)) is not None
    }
    return jsonify({'years': sorted(years, reverse=True)})


# ============== 赛段（Segment）分析 ==============

SEGMENTS_CACHE_TTL_SECONDS = 24 * 60 * 60  # 24 小时


def _segments_cache_path(name):
    return _cache_file(os.path.join("segments", f"{name}.json"))


def _load_segments_cache(name):
    """加载当前运动员的赛段缓存。"""
    cache = _read_json(_segments_cache_path(name))
    if not isinstance(cache, dict):
        return None
    if cache.get("athlete_id") != _current_athlete_id():
        return None
    cached_at = cache.get("cached_at")
    if not cached_at or time.time() - cached_at > SEGMENTS_CACHE_TTL_SECONDS:
        return None
    return cache.get("data")


def _save_segments_cache(name, data):
    cache = {
        "athlete_id": _current_athlete_id(),
        "cached_at": time.time(),
        "data": data,
    }
    _atomic_write_json(_segments_cache_path(name), cache)


def _strava_get(url, params=None, timeout=30):
    """使用有效 Token 向 Strava API 发送 GET 请求。"""
    token = get_valid_access_token()
    return requests.get(
        url,
        headers={"Authorization": f"Bearer {token}"},
        params=params,
        timeout=timeout,
    )


def _safe_number(value):
    """安全地把值转成 float，失败返回 None。"""
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _format_iso_local(iso_string):
    """把 ISO 时间串转为本地可读字符串。"""
    if not iso_string:
        return None
    try:
        dt = datetime.fromisoformat(iso_string.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d %H:%M")
    except Exception:
        return iso_string


def _extract_year_month(iso_string):
    """从 ISO 时间串提取年月，用于季节性聚合。"""
    if not iso_string:
        return None
    try:
        dt = datetime.fromisoformat(iso_string.replace("Z", "+00:00"))
        return (dt.year, dt.month)
    except Exception:
        return None


def _summarize_segment_effort(item):
    """从 DetailedSegmentEffort/SummarySegmentEffort JSON 提取前端需要的关键字段。"""
    segment = item.get("segment") or {}
    # Strava 的 segment/effort ID 是 64 位整数，前端 JS Number 会丢失精度，所以统一转成字符串。
    def _str_id(value):
        return str(value) if value is not None else None

    return {
        "effort_id": _str_id(item.get("id")),
        "segment_id": _str_id(segment.get("id")),
        "name": segment.get("name") or item.get("name") or "未命名赛段",
        "activity_id": _str_id((item.get("activity") or {}).get("id")),
        "start_date": item.get("start_date"),
        "start_date_local": item.get("start_date_local"),
        "elapsed_time": _safe_number(item.get("elapsed_time")),
        "moving_time": _safe_number(item.get("moving_time")),
        "average_watts": _safe_number(item.get("average_watts")),
        "device_watts": bool(item.get("device_watts")) if item.get("device_watts") is not None else None,
        "distance": _safe_number(segment.get("distance")),
        "average_grade": _safe_number(segment.get("average_grade")),
        "maximum_grade": _safe_number(segment.get("maximum_grade")),
        "elevation_high": _safe_number(segment.get("elevation_high")),
        "elevation_low": _safe_number(segment.get("elevation_low")),
        "start_latlng": segment.get("start_latlng"),
        "end_latlng": segment.get("end_latlng"),
        "city": segment.get("city"),
        "state": segment.get("state"),
        "country": segment.get("country"),
        "climb_category": segment.get("climb_category"),
        "activity_type": segment.get("activity_type") or segment.get("type"),
    }


def _compute_segment_deep_metrics(effort, athlete_weight_kg=None):
    """计算单次 effort 的深度指标：VAM、W/kg、效率比等。"""
    elapsed_time = _safe_number(effort.get("elapsed_time")) or 0
    moving_time = _safe_number(effort.get("moving_time")) or 0
    avg_watts = _safe_number(effort.get("average_watts"))
    elevation_high = _safe_number(effort.get("elevation_high")) or 0
    elevation_low = _safe_number(effort.get("elevation_low")) or 0
    segment_distance = _safe_number(effort.get("distance")) or 0

    weight = athlete_weight_kg or 70.0

    vam = None
    if moving_time > 0 and elevation_high > elevation_low:
        vam = round((elevation_high - elevation_low) / moving_time * 3600, 1)

    wkg = None
    if avg_watts and weight > 0:
        wkg = round(avg_watts / weight, 2)

    efficiency = None
    if elapsed_time > 0:
        efficiency = round(moving_time / elapsed_time, 3)

    # 估算功率体重比的理论参考：根据坡度粗略估算
    estimated_wkg = None
    if segment_distance > 0 and moving_time > 0 and avg_watts:
        gradient = (elevation_high - elevation_low) / segment_distance if segment_distance else 0
        # 简单估算：平路约 2.5 W/kg，每 1% 坡度约增加 0.15 W/kg（速度假设）
        estimated_wkg = round(2.5 + max(0, gradient) * 0.15, 2)

    return {
        "vam": vam,
        "wkg": wkg,
        "estimated_wkg": estimated_wkg,
        "efficiency": efficiency,
        "athlete_weight_used": weight,
    }


@app.route("/activities/<int:activity_id>/segments")
def get_activity_segments(activity_id):
    """获取某活动中包含的赛段 effort 摘要列表。"""
    import traceback

    if not session_state.get("client"):
        return jsonify({"error": "请先点击“连接并获取 Token”完成授权"}), 401

    _ensure_athlete_identity()
    cached = _load_segments_cache(f"activity_{activity_id}_segments")
    if cached is not None:
        return jsonify(cached)

    try:
        url = f"https://www.strava.com/api/v3/activities/{activity_id}"
        response = _strava_get(url, timeout=30)
        print(f"[/activities/{activity_id}/segments] Strava API status={response.status_code}")
        response.raise_for_status()
        activity = response.json()
    except requests.exceptions.RequestException as e:
        print(f"[/activities/{activity_id}/segments] 调用失败: {e}")
        traceback.print_exc()
        return jsonify({"error": f"调用 Strava 失败: {e}"}), 500

    segment_efforts = activity.get("segment_efforts") or []
    result = [_summarize_segment_effort(e) for e in segment_efforts]
    result.sort(key=lambda x: x.get("start_date") or "")

    _save_segments_cache(f"activity_{activity_id}_segments", result)
    return jsonify(result)


@app.route("/segments/<int:segment_id>/efforts")
def get_segment_efforts(segment_id):
    """获取某赛段下当前运动员的历史 effort 列表，用于趋势分析。

    Strava 此接口需要 subscription，调用失败会返回明确错误。
    """
    import traceback

    if not session_state.get("client"):
        return jsonify({"error": "请先点击“连接并获取 Token”完成授权"}), 401

    _ensure_athlete_identity()
    cached = _load_segments_cache(f"segment_{segment_id}_efforts")
    if cached is not None:
        return jsonify(cached)

    try:
        url = "https://www.strava.com/api/v3/segment_efforts"
        response = _strava_get(
            url,
            params={"segment_id": segment_id, "per_page": 200},
            timeout=60,
        )
        print(f"[/segments/{segment_id}/efforts] Strava API status={response.status_code}")
        response.raise_for_status()
        efforts = response.json()
    except requests.exceptions.HTTPError as e:
        status = e.response.status_code if hasattr(e, "response") else None
        detail = e.response.text[:200] if hasattr(e, "response") else str(e)
        print(f"[/segments/{segment_id}/efforts] HTTP 错误: {status}, {detail}")
        if status == 402:
            return jsonify({"error": "Strava 订阅（Subscription）权限不足，无法获取赛段历史 effort。"}), 402
        if status == 403:
            return jsonify({"error": "没有权限查看该赛段的历史 effort。"}), 403
        return jsonify({"error": f"调用 Strava 失败: {e}"}), 500
    except requests.exceptions.RequestException as e:
        print(f"[/segments/{segment_id}/efforts] 调用失败: {e}")
        traceback.print_exc()
        return jsonify({"error": f"调用 Strava 失败: {e}"}), 500

    summarized = [_summarize_segment_effort(e) for e in efforts]
    summarized.sort(key=lambda x: x.get("start_date") or "")

    # 季节性聚合：按年份、年份-月份统计平均用时/功率
    by_year = {}
    by_year_month = {}
    for e in summarized:
        ym = _extract_year_month(e.get("start_date_local") or e.get("start_date"))
        if not ym:
            continue
        y, m = ym
        key_y = str(y)
        key_ym = f"{y}-{m:02d}"
        by_year.setdefault(key_y, []).append(e)
        by_year_month.setdefault(key_ym, []).append(e)

    def _agg(items):
        times = [i["elapsed_time"] for i in items if i.get("elapsed_time")]
        watts = [i["average_watts"] for i in items if i.get("average_watts")]
        return {
            "count": len(items),
            "avg_elapsed_time": round(sum(times) / len(times), 1) if times else None,
            "avg_moving_time": round(sum(i["moving_time"] for i in items if i.get("moving_time")) / len([i for i in items if i.get("moving_time")]), 1) if any(i.get("moving_time") for i in items) else None,
            "avg_watts": round(sum(watts) / len(watts), 1) if watts else None,
        }

    result = {
        "segment_id": str(segment_id),
        "efforts": summarized,
        "by_year": {k: _agg(v) for k, v in sorted(by_year.items())},
        "by_year_month": {k: _agg(v) for k, v in sorted(by_year_month.items())},
    }

    _save_segments_cache(f"segment_{segment_id}_efforts", result)
    return jsonify(result)


@app.route("/segment_efforts/<int:effort_id>")
def get_segment_effort_detail(effort_id):
    """获取单次 effort 详情，并计算 VAM、W/kg、效率比等深度指标。

    Strava 此接口需要 subscription，调用失败会返回明确错误。
    """
    import traceback

    if not session_state.get("client"):
        return jsonify({"error": "请先点击“连接并获取 Token”完成授权"}), 401

    _ensure_athlete_identity()
    cached = _load_segments_cache(f"effort_{effort_id}")
    if cached is not None:
        return jsonify(cached)

    try:
        url = f"https://www.strava.com/api/v3/segment_efforts/{effort_id}"
        response = _strava_get(url, timeout=30)
        print(f"[/segment_efforts/{effort_id}] Strava API status={response.status_code}")
        response.raise_for_status()
        effort = response.json()
    except requests.exceptions.HTTPError as e:
        status = e.response.status_code if hasattr(e, "response") else None
        detail = e.response.text[:200] if hasattr(e, "response") else str(e)
        print(f"[/segment_efforts/{effort_id}] HTTP 错误: {status}, {detail}")
        if status == 402:
            return jsonify({"error": "Strava 订阅（Subscription）权限不足，无法获取赛段 effort 详情。"}), 402
        if status == 403:
            return jsonify({"error": "没有权限查看该赛段 effort 详情。"}), 403
        return jsonify({"error": f"调用 Strava 失败: {e}"}), 500
    except requests.exceptions.RequestException as e:
        print(f"[/segment_efforts/{effort_id}] 调用失败: {e}")
        traceback.print_exc()
        return jsonify({"error": f"调用 Strava 失败: {e}"}), 500

    summary = _summarize_segment_effort(effort)

    # 获取运动员体重用于 W/kg 计算
    athlete_weight = None
    try:
        athlete = get_cached_athlete()
        if athlete:
            athlete_weight = _safe_number(athlete.get("weight"))
    except Exception:
        athlete_weight = None

    metrics = _compute_segment_deep_metrics(summary, athlete_weight)

    # PR 信息
    athlete_segment_stats = effort.get("athlete_segment_stats") or {}
    pr_info = {
        "pr_elapsed_time": _safe_number(athlete_segment_stats.get("pr_elapsed_time")),
        "pr_date": athlete_segment_stats.get("pr_date"),
        "effort_count": _safe_number(athlete_segment_stats.get("effort_count")),
    }

    # 与 PR 的差距
    pr_gap = None
    if summary.get("elapsed_time") and pr_info.get("pr_elapsed_time"):
        pr_gap = round(summary["elapsed_time"] - pr_info["pr_elapsed_time"], 1)

    result = {
        "effort_id": str(effort_id),
        "summary": summary,
        "metrics": metrics,
        "pr": pr_info,
        "pr_gap_seconds": pr_gap,
        "raw": effort,
    }

    _save_segments_cache(f"effort_{effort_id}", result)
    return jsonify(result)


# ============== 训练负荷与状态 ==============

def _activity_local_date(activity):
    """按本地开始时间取得活动日期，用于训练日历聚合。"""
    dt = _activity_local_datetime(activity)
    return dt.date() if dt else None


def _calculate_activity_load(activity, ftp):
    """优先计算功率 TSS，无功率时回退到 Strava 强度评分。"""
    moving_time = _safe_number(activity.get("moving_time")) or 0
    normalized_power = _safe_number(activity.get("weighted_average_watts"))
    suffer_score = _safe_number(activity.get("suffer_score"))
    intensity_factor = None
    load = None
    method = "unavailable"

    if ftp and normalized_power and normalized_power > 0 and moving_time > 0:
        intensity_factor = normalized_power / ftp
        load = moving_time * normalized_power * intensity_factor / (ftp * 3600) * 100
        method = "power_tss"
    elif suffer_score is not None and suffer_score >= 0:
        load = suffer_score
        method = "suffer_score"

    return {
        "id": str(activity.get("id")) if activity.get("id") is not None else None,
        "name": activity.get("name") or "未命名活动",
        "type": activity.get("sport_type") or activity.get("type"),
        "start_date": activity.get("start_date"),
        "start_date_local": activity.get("start_date_local"),
        "date": _activity_local_date(activity),
        "moving_time": moving_time or None,
        "normalized_power": normalized_power,
        "intensity_factor": round(intensity_factor, 3) if intensity_factor is not None else None,
        "load": round(load, 1) if load is not None else None,
        "load_method": method,
    }


def _training_form_status(tsb):
    """将 TSB 转换为可展示的训练状态。"""
    if tsb >= 15:
        return {"key": "fresh", "label": "恢复充分", "description": "身体状态较为新鲜，可结合训练计划安排高质量训练。"}
    if tsb >= 5:
        return {"key": "ready", "label": "状态良好", "description": "疲劳较低，适合维持正常训练节奏。"}
    if tsb >= -10:
        return {"key": "balanced", "label": "负荷平衡", "description": "训练刺激与恢复相对平衡，注意观察身体反馈。"}
    if tsb >= -25:
        return {"key": "fatigued", "label": "疲劳累积", "description": "近期负荷较高，建议关注睡眠与恢复。"}
    return {"key": "strained", "label": "高负荷状态", "description": "短期负荷明显高于长期水平，建议优先恢复并谨慎安排强度。"}


def _build_training_load(activities, ftp, days, today):
    """聚合训练负荷，并用展示区间之前的历史预热 ATL/CTL。"""
    details = []
    for activity in activities:
        detail = _calculate_activity_load(activity, ftp)
        if detail["date"] is None or detail["date"] > today:
            continue
        details.append(detail)

    details.sort(key=lambda item: item.get("start_date") or "", reverse=True)
    range_start = today - timedelta(days=days - 1)
    visible_details = [item for item in details if item["date"] >= range_start]

    daily_loads = {}
    daily_counts = {}
    for item in details:
        day = item["date"]
        daily_counts[day] = daily_counts.get(day, 0) + 1
        if item["load"] is not None:
            daily_loads[day] = daily_loads.get(day, 0) + item["load"]

    first_day = min(daily_loads) if daily_loads else today
    atl = 0.0
    ctl = 0.0
    form_by_day = {}
    for offset in range((today - first_day).days + 1):
        day = first_day + timedelta(days=offset)
        load = daily_loads.get(day, 0)
        atl += (load - atl) / 7
        ctl += (load - ctl) / 42
        form_by_day[day] = {"atl": atl, "ctl": ctl, "tsb": ctl - atl}

    daily = []
    for offset in range(days):
        day = range_start + timedelta(days=offset)
        form = form_by_day.get(day, {"atl": 0, "ctl": 0, "tsb": 0})
        daily.append({
            "date": day.isoformat(),
            "load": round(daily_loads.get(day, 0), 1),
            "activity_count": daily_counts.get(day, 0),
            "atl": round(form["atl"], 1),
            "ctl": round(form["ctl"], 1),
            "tsb": round(form["tsb"], 1),
        })

    current_form = form_by_day.get(today, {"atl": 0, "ctl": 0, "tsb": 0})
    current_week_start = today - timedelta(days=6)
    previous_week_start = today - timedelta(days=13)
    current_week_load = sum(daily_loads.get(current_week_start + timedelta(days=i), 0) for i in range(7))
    previous_week_load = sum(daily_loads.get(previous_week_start + timedelta(days=i), 0) for i in range(7))
    week_change_pct = None
    if previous_week_load > 0:
        week_change_pct = round((current_week_load - previous_week_load) / previous_week_load * 100, 1)
    elif current_week_load == 0:
        week_change_pct = 0.0

    current_monday = today - timedelta(days=today.weekday())
    first_monday = current_monday - timedelta(weeks=11)
    weekly = []
    for week_index in range(12):
        week_start = first_monday + timedelta(weeks=week_index)
        load = sum(daily_loads.get(week_start + timedelta(days=i), 0) for i in range(7))
        weekly.append({
            "week_start": week_start.isoformat(),
            "label": week_start.strftime("%m/%d"),
            "load": round(load, 1),
        })

    source_counts = {
        "power_tss": sum(item["load_method"] == "power_tss" for item in visible_details),
        "suffer_score": sum(item["load_method"] == "suffer_score" for item in visible_details),
        "unavailable": sum(item["load_method"] == "unavailable" for item in visible_details),
    }
    total_load = sum(item["load"] or 0 for item in visible_details)
    status = _training_form_status(current_form["tsb"])

    return {
        "range": {"days": days, "start": range_start.isoformat(), "end": today.isoformat()},
        "summary": {
            "ftp": round(ftp, 1) if ftp else None,
            "atl": round(current_form["atl"], 1),
            "ctl": round(current_form["ctl"], 1),
            "tsb": round(current_form["tsb"], 1),
            "status": status,
            "current_week_load": round(current_week_load, 1),
            "previous_week_load": round(previous_week_load, 1),
            "week_change_pct": week_change_pct,
            "activity_count": len(visible_details),
            "total_load": round(total_load, 1),
            "source_counts": source_counts,
        },
        "daily": daily,
        "weekly": weekly,
        "activities": visible_details[:15],
    }


@app.route("/training-load")
def get_training_load():
    """返回训练负荷、短期/长期负荷趋势及当前训练状态。"""
    days = request.args.get("days", default=90, type=int)
    if days not in {30, 90, 180, 365}:
        return jsonify({"error": "days 仅支持 30、90、180、365"}), 400

    ftp = None
    if "ftp" in request.args:
        ftp = request.args.get("ftp", type=float)
        if ftp is None or not math.isfinite(ftp) or ftp <= 0:
            return jsonify({"error": "FTP 必须是大于 0 的数值"}), 400
    else:
        athlete = get_cached_athlete() or {}
        ftp = _safe_number(athlete.get("ftp"))
        if ftp is not None and ftp <= 0:
            ftp = None

    cache = load_cache()
    today = datetime.now().astimezone().date()
    result = _build_training_load(cache.get("activities", []), ftp, days, today)
    return jsonify(result)


def auto_sync_loop():
    """后台线程：定期增量同步，并由同步函数按周期全量对账。"""
    while True:
        time.sleep(AUTO_SYNC_INTERVAL_SECONDS)
        try:
            if session_state.get("client"):
                sync_activities()
        except Exception as e:
            print(f"[{datetime.now(timezone.utc)}] 自动同步失败: {e}")


if __name__ == "__main__":
    sync_thread = threading.Thread(target=auto_sync_loop, daemon=True)
    sync_thread.start()

    app.run(host="127.0.0.1", port=PORT, debug=True, use_reloader=False)
