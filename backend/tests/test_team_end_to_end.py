"""Team-owned receipt-to-settlement flow for the Sprint 3 CI gate."""

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def test_mock_receipt_reaches_an_exact_settlement(client, seeded_user):
    uploaded = client.post(
        "/receipts",
        params={"filename": "team-flow.png"},
        content=PNG,
        headers={"Content-Type": "image/png"},
    )
    assert uploaded.status_code == 201

    receipt = client.post(f"/receipts/{uploaded.json()['id']}/ocr")
    assert receipt.status_code == 200
    receipt = receipt.json()
    assert receipt["status"] == "processed"
    assert receipt["ocr_provider"] == "mock"
    assert receipt["items"]

    confirmed = client.post(
        f"/receipts/{receipt['id']}/confirm",
        json={
            "revision": receipt["revision"],
            "items": [
                {
                    "id": item["id"],
                    "name": item["name"],
                    "quantity": item["quantity"],
                    "unit_price_cents": item["unit_price_cents"],
                    "preserve_total": True,
                }
                for item in receipt["items"]
            ],
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    bill_id = confirmed.json()["bill_id"]

    diner_ids = []
    for name in ("Alex", "Blair", "Casey"):
        created = client.post(f"/bills/{bill_id}/diners", json={"name": name})
        assert created.status_code == 201
        diner_ids.append(created.json()["id"])

    summary = client.get(f"/bills/{bill_id}/allocation-summary").json()
    for index, item in enumerate(summary["items"]):
        participants = diner_ids if index % 2 == 0 else [diner_ids[index % len(diner_ids)]]
        claimed = client.put(
            f"/bills/{bill_id}/items/{item['id']}/claims",
            json={"diner_ids": participants},
        )
        assert claimed.status_code == 200, claimed.text

    ready = client.post(f"/bills/{bill_id}/settlement-readiness")
    assert ready.status_code == 200, ready.text
    summary = ready.json()
    assert summary["unassigned_item_ids"] == []
    assert sum(summary["subtotals"].values()) == sum(
        item["price_cents"] for item in summary["items"]
    )

    settlement = client.post(
        "/api/settlements/calculate",
        json={
            "title": "Team end-to-end dinner",
            "diners": [
                {"id": str(diner["id"]), "name": diner["name"]} for diner in summary["diners"]
            ],
            "items": [
                {
                    "id": str(item["id"]),
                    "name": item["name"],
                    "quantity": 1,
                    "unit_price_cents": item["price_cents"],
                    "participant_ids": [
                        str(diner_id) for diner_id in summary["assignments"][str(item["id"])]
                    ],
                }
                for item in summary["items"]
            ],
            "tip_percent": 10,
            "service_percent": 5,
            "rounding": "exact",
        },
    )
    assert settlement.status_code == 200, settlement.text
    result = settlement.json()
    assert result["subtotal_cents"] == sum(item["price_cents"] for item in summary["items"])
    assert sum(diner["final_cents"] for diner in result["diners"]) == result["total_cents"]
