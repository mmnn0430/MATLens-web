"""Cloud Storage Provider for MatLens 2.0.

Provides unified file persistence:
- Local filesystem storage (LocalFileStorage) for local development & testing
- Google Cloud Storage (GoogleCloudStorage) for production deployment on Cloud Run
"""
from __future__ import annotations

import os
import shutil
from abc import ABC, abstractmethod
from pathlib import Path
from typing import BinaryIO, Optional


class StorageProvider(ABC):
    @abstractmethod
    def save_file(self, destination_path: str, data: bytes) -> str:
        """Saves bytes and returns the resolved storage URI."""
        pass

    @abstractmethod
    def read_file(self, storage_path: str) -> bytes:
        """Reads and returns file bytes."""
        pass

    @abstractmethod
    def delete_file(self, storage_path: str) -> bool:
        """Deletes a file from storage."""
        pass

    @abstractmethod
    def exists(self, storage_path: str) -> bool:
        """Checks if a file exists."""
        pass


class LocalFileStorage(StorageProvider):
    def __init__(self, base_dir: Path):
        self.base_dir = Path(base_dir).resolve()
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _resolve(self, path: str) -> Path:
        clean = path.lstrip("/\\")
        return self.base_dir / clean

    def save_file(self, destination_path: str, data: bytes) -> str:
        p = self._resolve(destination_path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        return str(p)

    def read_file(self, storage_path: str) -> bytes:
        p = self._resolve(storage_path) if not Path(storage_path).is_absolute() else Path(storage_path)
        return p.read_bytes()

    def delete_file(self, storage_path: str) -> bool:
        p = self._resolve(storage_path) if not Path(storage_path).is_absolute() else Path(storage_path)
        if p.exists():
            p.unlink()
            return True
        return False

    def exists(self, storage_path: str) -> bool:
        p = self._resolve(storage_path) if not Path(storage_path).is_absolute() else Path(storage_path)
        return p.exists()


class GoogleCloudStorage(StorageProvider):
    def __init__(self, bucket_name: str):
        self.bucket_name = bucket_name
        self._client = None
        self._bucket = None

    def _get_bucket(self):
        if self._bucket is None:
            from google.cloud import storage
            self._client = storage.Client()
            self._bucket = self._client.bucket(self.bucket_name)
        return self._bucket

    def save_file(self, destination_path: str, data: bytes) -> str:
        blob = self._get_bucket().blob(destination_path.lstrip("/"))
        blob.upload_from_string(data)
        return f"gs://{self.bucket_name}/{destination_path.lstrip('/')}"

    def read_file(self, storage_path: str) -> bytes:
        path = storage_path.replace(f"gs://{self.bucket_name}/", "").lstrip("/")
        blob = self._get_bucket().blob(path)
        return blob.download_as_bytes()

    def delete_file(self, storage_path: str) -> bool:
        path = storage_path.replace(f"gs://{self.bucket_name}/", "").lstrip("/")
        blob = self._get_bucket().blob(path)
        if blob.exists():
            blob.delete()
            return True
        return False

    def exists(self, storage_path: str) -> bool:
        path = storage_path.replace(f"gs://{self.bucket_name}/", "").lstrip("/")
        blob = self._get_bucket().blob(path)
        return blob.exists()


def get_storage_provider() -> StorageProvider:
    """Factory selecting GoogleCloudStorage when GCS_BUCKET is configured,
    otherwise falling back cleanly to LocalFileStorage.
    """
    gcs_bucket = os.environ.get("GCS_BUCKET")
    if gcs_bucket:
        try:
            return GoogleCloudStorage(gcs_bucket)
        except Exception:
            pass
    # Local fallback
    local_dir = Path(__file__).resolve().parent.parent.parent.parent / "storage"
    return LocalFileStorage(local_dir)
