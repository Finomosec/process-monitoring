# process-monitoring

## Usage:
```
curl -w '\n' "http://SERVER:PORT/api/started?pid=$$&name=NAME"
# do stuff
curl -w '\n' "http://SERVER:PORT/api/finished?pid=$$"
```
