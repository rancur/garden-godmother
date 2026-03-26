FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/* \
    && git config --global --add safe.directory /app
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN chmod +x entrypoint.sh
RUN mkdir -p /app/data
# Build the read-only plant reference database (ships with the image)
RUN python3 create_reference_db.py
EXPOSE 3402
ENTRYPOINT ["./entrypoint.sh"]
