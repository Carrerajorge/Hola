from __future__ import annotations

import uvicorn

from iliagpt_ocr.infra.settings import get_settings


def main() -> None:
    s = get_settings()
    uvicorn.run(
        "iliagpt_ocr.api.main:app",
        host=s.host,
        port=s.port,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()

