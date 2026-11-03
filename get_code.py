import os
import secrets
import webbrowser
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

# stravalib 在 Client() 缺少 STRAVA_CLIENT_ID/SECRET 环境变量时会打印 token 刷新警告；
# 本脚本自己用 code 换 token，无需 stravalib 自动刷新，直接静音该警告。
os.environ.setdefault("SILENCE_TOKEN_WARNINGS", "true")

from stravalib import Client

CLIENT_ID = os.environ.get("STRAVA_CLIENT_ID", "").strip()
CLIENT_SECRET = os.environ.get("STRAVA_CLIENT_SECRET", "").strip()
PORT = int(os.environ.get("PORT", "5001"))
REDIRECT_URI = f"http://127.0.0.1:{PORT}/authorization"
SCOPE = "read,activity:read,profile:read_all"

code = None
access_token = None
refresh_token = None


def build_auth_url(state):
    params = {
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPE,
        "state": state,
    }
    return "https://www.strava.com/oauth/mobile/authorize?" + urllib.parse.urlencode(
        params
    )


def wait_for_code():
    """启动本地 HTTP 服务器、打开浏览器，校验 state 后返回 code。"""
    result = {"code": None}
    expected_state = secrets.token_urlsafe(32)

    class OAuthHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            query = urllib.parse.parse_qs(parsed.query)
            code_value = query.get("code", [None])[0]
            returned_state = query.get("state", [None])[0]
            state_valid = returned_state and secrets.compare_digest(
                expected_state, returned_state
            )

            if code_value and state_valid:
                result["code"] = code_value
                status = 200
                message = "授权成功，可以关闭此页面。"
            else:
                status = 400
                message = "授权回调校验失败，请返回终端重新发起授权。"

            self.send_response(status)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(
                f"<html><body><h1>{message}</h1></body></html>".encode("utf-8")
            )

        def log_message(self, format, *args):
            pass

    auth_url = build_auth_url(expected_state)
    print(f"授权 URL: {auth_url}")
    print(f"等待浏览器跳转，监听 {REDIRECT_URI} ...\n")

    server = HTTPServer(("127.0.0.1", PORT), OAuthHandler)
    webbrowser.open(auth_url)

    server.handle_request()
    server.server_close()

    return result["code"]


def exchange_token(code_value):
    """用 code 换取 Token，并设置好已授权的 client。"""
    global access_token, refresh_token

    client = Client()
    response = client.exchange_code_for_token(
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        code=code_value,
    )

    access_token = response["access_token"]
    refresh_token = response["refresh_token"]
    client.access_token = access_token

    return client


def fetch_athlete(client):
    """使用已授权的 client 获取当前运动员信息。"""
    athlete = client.get_athlete()

    print("\n运动员信息:")
    print(f"  ID:   {athlete.id}")
    print(f"  姓名: {athlete.firstname} {athlete.lastname}")
    print(f"  城市: {getattr(athlete, 'city', None)}")
    print(f"  国家: {getattr(athlete, 'country', None)}")

    return athlete


def main():
    global code

    if not CLIENT_ID or not CLIENT_SECRET:
        print("请先设置 STRAVA_CLIENT_ID 和 STRAVA_CLIENT_SECRET 环境变量")
        return

    code = wait_for_code()
    if not code:
        print("未获取到有效授权回调")
        return

    try:
        client = exchange_token(code)
    except Exception as e:
        print(f"\n用 code 换取 token 失败: {e}")
        return

    try:
        fetch_athlete(client)
    except Exception as e:
        print(f"\n获取运动员信息失败: {e}")


if __name__ == "__main__":
    main()
