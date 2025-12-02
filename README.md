process-monitoring

usage:

curl -w '\n' "http://SERVER:PORT/api/started?pid=$$&name=NAME" || true
# do stuff
curl -w '\n' "http://SERVER:PORT/api/finished?pid=$$" || true
