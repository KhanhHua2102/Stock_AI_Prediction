FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app/ ./app/

# Create data/runtime directory
RUN mkdir -p /app/data/runtime

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV PT_PROJECT_DIR=/project
ENV PT_HUB_DATA_DIR=/project/data/runtime

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
