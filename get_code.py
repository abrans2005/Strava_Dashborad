import webbrowser
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
from stravalib import Client

# 配置参数
CLIENT_ID = "117705"
CLIENT_SECRET = "fb23832768654cfe5ffa53ee6eb80e349b0d6461"
REDIRECT_URI = "http://127.0.0.1:5000/authorization"
SCOPE = "read,activity:read"

# 授权流程中需要保存的结果
code = None
access_token = None
refresh_token = None


def build_auth_url():
    params = {
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPE,
    }
    return "https://www.strava.com/oauth/mobile/authorize?" + urllib.parse.urlencode(
        params
    )


def wait_for_code():
    """启动本地 HTTP 服务器、打开浏览器，等待回调并返回 code。"""
    result = {"code": None}

    class OAuthHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            query = urllib.parse.parse_qs(parsed.query)
            result["code"] = query.get("code", [None])[0]

            if result["code"]:
                print(f"\n获取到 code: {result['code']}\n")
            else:
                print("\n回调 URL 中没有 code 参数\n")

            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(
                "<html><body><h1>授权成功，可以关闭此页面。</h1></body></html>".encode(
                    "utf-8"
                )
            )

        def log_message(self, format, *args):
            pass

    auth_url = build_auth_url()
    print(f"授权 URL: {auth_url}")
    print(f"等待浏览器跳转，监听 {REDIRECT_URI} ...\n")

    server = HTTPServer(("127.0.0.1", 5000), OAuthHandler)
    webbrowser.open(auth_url)

    server.handle_request()
    server.server_close()

    return result["code"]


def exchange_token(code_value):
    """用 code 换取 access_token 和 refresh_token，并设置好已授权的 client。"""
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
    global code, access_token, refresh_token

    code = wait_for_code()
    if not code:
        print("未获取到 code")
        return

    print(f"保存到变量 code 的值: {code}")

    try:
        client = exchange_token(code)
    except Exception as e:
        print(f"\n用 code 换取 token 失败: {e}")
        return

    print(f"access_token:  {access_token}")
    print(f"refresh_token: {refresh_token}")

    try:
        fetch_athlete(client)
    except Exception as e:
        print(f"\n获取运动员信息失败: {e}")


if __name__ == "__main__":
    main()
