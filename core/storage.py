import json


def load_json(path, default=None):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return {} if default is None else default


def save_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f)
