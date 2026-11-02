FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install Korean Nanum fonts for ReportLab/Matplotlib PDF export + OpenCV headless runtime libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-nanum \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/backend
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend /workspace/backend
COPY samples /workspace/samples

RUN python scripts/build_samples_and_refs.py

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
