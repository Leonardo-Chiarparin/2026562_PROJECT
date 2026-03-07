FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# The -u (unbuffered) flag is crucial to see real-time logs within the Docker console
CMD ["python", "-u", "main.py"]