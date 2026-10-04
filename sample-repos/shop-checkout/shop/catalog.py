"""Products and their list prices, in cents."""

PRODUCTS = {
    "mug": {"name": "Coffee mug", "price": 1200, "weight": 400},
    "tee": {"name": "T-shirt", "price": 2500, "weight": 200},
    "poster": {"name": "Poster", "price": 1800, "weight": 150},
}


def lookup(sku: str) -> dict:
    product = PRODUCTS.get(sku)
    if product is None:
        raise KeyError(f"unknown product {sku}")
    return product
