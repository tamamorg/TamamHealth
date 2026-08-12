FROM alpine:3.19.8

RUN apk add --no-cache curl jq

COPY dump-couchdb.sh /usr/local/bin/dump-couchdb.sh
RUN chmod 0555 /usr/local/bin/dump-couchdb.sh

CMD ["sh", "-c", "echo '15 2 * * * /usr/local/bin/dump-couchdb.sh >> /backups/backup.log 2>&1' > /etc/crontabs/root && exec crond -f -l 2"]
