from typing import Literal
from pydantic import BaseModel, Field, ConfigDict, model_validator


class Settings(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra='forbid')
    x_col: int = Field(0, ge=0, le=30)
    y_col: int = Field(1, ge=0, le=30)
    wavelength: float = Field(1.5406, gt=0, le=5)
    wavelength_confirmed: bool = False
    low: float = Field(10, gt=0, lt=179)
    high: float = Field(90, gt=0, lt=179)
    als_lambda: float = Field(1e6, ge=100, le=1e10)
    smooth: int = Field(9, ge=0, le=51)
    prominence: float = Field(0.04, ge=0.005, le=0.8)
    separation: float = Field(0.25, ge=0.03, le=5)
    k: float = Field(0.9, ge=0.1, le=2)
    instrumental: float = Field(0, ge=0, le=3)
    tolerance: float = Field(0.25, ge=0.03, le=1)
    excluded_peaks: list[int] = Field(default_factory=list, max_length=300)
    elements: str = Field('', max_length=150)
    reference_source: Literal['local', 'mp', 'combined'] = 'local'
    mp_snapshot: str | None = Field(None, pattern=r'^[a-f0-9]{32}$')
    mp_ids: list[str] = Field(default_factory=list, max_length=20)
    roi: list[int] | None = Field(None, min_length=4, max_length=4)
    scale_px: float = Field(100, gt=0, le=20000)
    scale_length: float = Field(1, gt=0, le=1e9)
    scale_unit: Literal['nm', 'µm'] = 'µm'
    scale_confirmed: bool = False
    invert: bool = False
    min_size: int = Field(40, ge=5, le=100000)
    min_distance: int = Field(12, ge=2, le=200)
    exclude_border: bool = True
    excluded_objects: list[int] = Field(default_factory=list, max_length=10000)
    segmentation_confirmed: bool = False
    same_sample: bool = False
    ai: bool = False

    @model_validator(mode='after')
    def bounds(self):
        if self.high <= self.low:
            raise ValueError('종료 각도는 시작 각도보다 커야 합니다.')
        if self.x_col == self.y_col:
            raise ValueError('각도와 강도 열은 달라야 합니다.')
        return self


class Claim(BaseModel):
    kind: Literal['observation', 'hypothesis', 'limitation', 'next_experiment']
    text: str = Field(max_length=1500)
    evidence_ids: list[str] = Field(min_length=1)


class AIReport(BaseModel):
    claims: list[Claim] = Field(min_length=1, max_length=16)
