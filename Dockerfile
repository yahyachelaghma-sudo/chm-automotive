FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 PORT=8000
WORKDIR /app
COPY . .
RUN chmod +x entrypoint.sh
EXPOSE 8000
CMD ["./entrypoint.sh"]
