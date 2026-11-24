from decimal import ROUND_HALF_UP, Decimal

from app.allocation import allocate_proportionally, richer_pays_more

from .models import DinerSettlement, SettlementRequest, SettlementResult


def percentage_of(cents: int, percent: float) -> int:
    value = Decimal(cents) * Decimal(str(percent)) / Decimal(100)
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def round_to_five(cents: int) -> int:
    return int((Decimal(cents) / Decimal(5)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)) * 5


def calculate_settlement(request: SettlementRequest) -> SettlementResult:
    lines = [
        (
            item.total_cents
            if item.total_cents is not None
            else item.quantity * item.unit_price_cents,
            item.participant_ids,
        )
        for item in request.items
    ]
    food = richer_pays_more(lines, [diner.id for diner in request.diners])
    subtotal = sum(total for total, _ in lines)

    tip = (
        request.tip_amount_cents
        if request.tip_amount_cents is not None
        else percentage_of(subtotal, request.tip_percent)
    )
    service = (
        request.service_amount_cents
        if request.service_amount_cents is not None
        else percentage_of(subtotal, request.service_percent)
    )
    tips = allocate_proportionally(tip, food)
    services = allocate_proportionally(service, food)
    extras = {key: tips[key] + services[key] for key in food}
    pre_round = {key: food[key] + extras[key] for key in food}

    rounded = dict(pre_round)
    if request.rounding == "cash":
        rounded = {key: round_to_five(value) for key, value in pre_round.items()}
        target = round_to_five(subtotal + tip + service)
        difference = target - sum(rounded.values())
        keys = sorted(rounded, key=lambda key: (-pre_round[key], key))
        step = 5 if difference > 0 else -5
        index = 0
        while difference:
            rounded[keys[index % len(keys)]] += step
            difference -= step
            index += 1

    diners = []
    by_id = {diner.id: diner for diner in request.diners}
    for diner_id in food:
        diners.append(
            DinerSettlement(
                id=diner_id,
                name=by_id[diner_id].name,
                food_cents=food[diner_id],
                extras_cents=extras[diner_id],
                tip_cents=tips[diner_id],
                service_cents=services[diner_id],
                rounding_cents=rounded[diner_id] - pre_round[diner_id],
                final_cents=rounded[diner_id],
            )
        )

    total = sum(rounded.values())
    return SettlementResult(
        subtotal_cents=subtotal,
        tip_cents=tip,
        service_cents=service,
        rounding_cents=total - (subtotal + tip + service),
        total_cents=total,
        diners=diners,
    )
