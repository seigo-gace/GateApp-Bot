FROM python:3.12-alpine
WORKDIR /guard
COPY guard.py /guard/guard.py
RUN addgroup -S guard && adduser -S -G guard guard && mkdir /state && chown guard:guard /state
USER guard
CMD ["python3", "-u", "/guard/guard.py"]
