import pytest
from fastapi import HTTPException

from app.routers.marketplace import _filter


def test_filter_accepts_normal_location():
    assert _filter("Uttar Pradesh", "state") == "Uttar Pradesh"


def test_filter_rejects_postgrest_control_characters():
    with pytest.raises(HTTPException) as exc:
        _filter("wheat),status.neq.sold", "search")
    assert exc.value.status_code == 422
