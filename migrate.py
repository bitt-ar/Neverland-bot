"""One-time migration: old JSON files + activity.db → MongoDB.

Usage:
    python migrate.py --guild-id <your_current_guild_id>
(or set GUILD_ID in .env and run without arguments)

Originals are moved to data/backup/ — nothing is deleted.
"""
import argparse
import asyncio
import json
import os
import shutil
import sqlite3
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
BACKUP_DIR = DATA_DIR / "backup"

MONGODB_URI = os.getenv("MONGODB_URI")
MONGODB_DB = os.getenv("MONGODB_DB", "neverland")


def load_json(path: Path):
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


async def migrate(guild_id: int):
    if not MONGODB_URI:
        raise SystemExit("MONGODB_URI is not set (see .env.example).")
    client = AsyncIOMotorClient(MONGODB_URI)
    db = client[MONGODB_DB]
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    # users.json -> levels (old XP/level/background/theme belong to your current guild)
    users = load_json(DATA_DIR / "users.json")
    if users:
        docs = []
        for uid, info in users.items():
            doc = {
                "guild_id": guild_id,
                "user_id": int(uid),
                "xp": info.get("xp", 0),
                "level": info.get("level", 0.0),
            }
            if "background" in info:
                doc["background"] = info["background"]
            if "theme" in info:
                doc["theme"] = info["theme"]
            docs.append(doc)
        try:
            await db.levels.insert_many(docs, ordered=False)
        except Exception as e:
            print(f"levels: skipped duplicates ({e})")
        print(f"levels: migrated {len(docs)} users into guild {guild_id}")
        shutil.move(str(DATA_DIR / "users.json"), str(BACKUP_DIR / "users.json"))

    # data.json -> giveaways
    giveaways = load_json(DATA_DIR / "data.json")
    if giveaways:
        docs = []
        for msg_id, info in giveaways.items():
            doc = dict(info)
            doc["message_id"] = str(msg_id)
            docs.append(doc)
        try:
            await db.giveaways.insert_many(docs, ordered=False)
        except Exception as e:
            print(f"giveaways: skipped duplicates ({e})")
        print(f"giveaways: migrated {len(docs)} entries")
        shutil.move(str(DATA_DIR / "data.json"), str(BACKUP_DIR / "data.json"))

    # anime.json -> anime_lists (one document per user, array of animes)
    anime = load_json(DATA_DIR / "anime.json")
    if anime:
        count = 0
        for uid, animes in anime.items():
            docs = []
            for title, info in animes.items():
                doc = dict(info)
                doc["title"] = title
                docs.append(doc)
            if docs:
                await db.anime_lists.update_one(
                    {"user_id": int(uid)}, {"$set": {"animes": docs}}, upsert=True
                )
                count += len(docs)
        print(f"anime_lists: migrated {count} entries")
        shutil.move(str(DATA_DIR / "anime.json"), str(BACKUP_DIR / "anime.json"))

    # activity.db (sqlite) -> activity
    db_file = DATA_DIR / "activity.db"
    if not db_file.exists():
        db_file = BASE_DIR / "activity.db"
    if db_file.exists():
        conn = sqlite3.connect(str(db_file))
        rows = conn.execute("SELECT user_id, guild_id, voice_time, messages, week_start FROM members").fetchall()
        conn.close()
        if rows:
            docs = [
                {
                    "user_id": r[0],
                    "guild_id": r[1],
                    "voice_time": r[2] or 0,
                    "messages": r[3] or 0,
                    "week_start": r[4],
                }
                for r in rows
            ]
            try:
                await db.activity.insert_many(docs, ordered=False)
            except Exception as e:
                print(f"activity: skipped duplicates ({e})")
        print(f"activity: migrated {len(rows)} rows")
        shutil.move(str(db_file), str(BACKUP_DIR / "activity.db"))

    client.close()
    print("Migration complete. Originals moved to data/backup/.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate old JSON/sqlite data to MongoDB")
    parser.add_argument("--guild-id", type=int, default=int(os.getenv("GUILD_ID") or 0),
                        help="Your current server ID (old data will belong to it)")
    args = parser.parse_args()
    if not args.guild_id:
        raise SystemExit("Provide --guild-id <id> (or set GUILD_ID in .env).")
    asyncio.run(migrate(args.guild_id))
