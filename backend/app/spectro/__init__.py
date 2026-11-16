"""FT-IR / DSC / TGA independent raw-data analysis package.

This package is intentionally isolated from the XRD·SEM integrated pipeline and the UTM module:
- separate storage namespace (STORAGE_DIR/spectro)
- separate API prefix (/api/spectro)
- results are never merged into XRD·SEM integrated interpretation.
"""

SPECTRO_ENGINE_VERSION = "matlens-spectro-1.0.0"
SPECTRO_AI_PROMPT_VERSION = "matlens-spectro-gemini-v1.0"
INSTRUMENTS = ("ftir", "dsc", "tga")
