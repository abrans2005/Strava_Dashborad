from stravalib import Client

client = Client()
url = client.authorization_url(
    client_id=117705,
    redirect_uri="http://127.0.0.1:5000/authorization",
)
print(url)

token_response = client.exchange_code_for_token(
    client_id='117705', client_secret='fb23832768654cfe5ffa53ee6eb80e349b0d6461', code='2a381ebf30d608eb53d2fbeebae435b21cfeaf28'
)
# The token response above contains both an access_token and a refresh token.
access_token = token_response["access_token"]
refresh_token = token_response["refresh_token"]

print(refresh_token)
print(access_token)  # You'll need this in 6 hours
