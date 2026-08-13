import json
import re
from pathlib import Path
from typing import List, Dict, Any, Optional

CACHE_DIR = Path("cache").resolve()
CACHE_FILE = CACHE_DIR / "extracted_courses.json"


def clean_course_key(course_name: str) -> str:
    """Creates a normalized cache key for course title (stripping dynamic tags like Week 2/12)."""
    if not course_name:
        return "default_course"
    cleaned = re.sub(r'\s*\((?:Week|DSTP).*?\)', '', course_name, flags=re.IGNORECASE).strip().lower()
    return cleaned or "default_course"


class CacheManager:
    def __init__(self, cache_file: Optional[Path] = None):
        self.cache_file = cache_file or CACHE_FILE
        self.cache_dir = self.cache_file.parent
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._data: Dict[str, Any] = self._load()

    def _load(self) -> Dict[str, Any]:
        if self.cache_file.exists():
            try:
                return json.loads(self.cache_file.read_text(encoding="utf-8"))
            except Exception as e:
                print(f"[CacheManager] Failed to load cache file: {e}")
        return {}

    def _save(self) -> None:
        try:
            self.cache_file.write_text(json.dumps(self._data, indent=2, ensure_ascii=False), encoding="utf-8")
        except Exception as e:
            print(f"[CacheManager] Error saving cache: {e}")

    def get_cached_topics(self, course_name: str, target_week: str = "ALL") -> Optional[List[Dict[str, Any]]]:
        """Returns cached topics if available and complete."""
        course_key = clean_course_key(course_name)
        if course_key not in self._data:
            return None

        course_cache = self._data[course_key]
        weeks_data = course_cache.get("weeks", {})

        if target_week != "ALL":
            clean_w = target_week.strip()
            if clean_w in weeks_data:
                topics = weeks_data[clean_w]
                if topics and len(topics) > 0:
                    for t in topics:
                        t["source"] = "cache"
                    return topics
            return None
        else:
            # Flatten all cached weeks
            all_topics = []
            for w_name, topics in weeks_data.items():
                for t in topics:
                    t_copy = dict(t)
                    t_copy["source"] = "cache"
                    all_topics.append(t_copy)
            return all_topics if all_topics else None

    def save_topics(self, course_name: str, target_week: str, topics: List[Dict[str, Any]]) -> None:
        """Saves extracted topics into local JSON cache."""
        if not topics:
            return

        course_key = clean_course_key(course_name)
        if course_key not in self._data:
            self._data[course_key] = {
                "course_name": course_name,
                "weeks": {}
            }

        weeks_data = self._data[course_key]["weeks"]

        # Group topics by week
        grouped: Dict[str, List[Dict[str, Any]]] = {}
        for t in topics:
            w = t.get("week") or target_week or "Week 01"
            if w not in grouped:
                grouped[w] = []
            
            t_clean = dict(t)
            # Remove transient keys before saving
            t_clean.pop("source", None)
            grouped[w].append(t_clean)

        for w_name, t_list in grouped.items():
            weeks_data[w_name] = t_list

        self._save()

    def merge_hybrid_topics(self, course_name: str, week: str, live_topics: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Merges live extracted topics with existing cached topics."""
        cached = self.get_cached_topics(course_name, week) or []
        cached_map = { (t.get("week", ""), t.get("topic_title", "")): t for t in cached }

        result = []
        for l_topic in live_topics:
            key = (l_topic.get("week", ""), l_topic.get("topic_title", ""))
            has_live_yt = l_topic.get("youtube_url") and l_topic["youtube_url"].startswith("https://www.youtube.com")

            if has_live_yt:
                l_topic["source"] = "live"
                result.append(l_topic)
            elif key in cached_map and cached_map[key].get("youtube_url") and cached_map[key]["youtube_url"].startswith("https://www.youtube.com"):
                c_topic = cached_map[key]
                c_topic["source"] = "cache"
                result.append(c_topic)
            else:
                l_topic["source"] = "live"
                result.append(l_topic)

        # Update cache with final merged list
        self.save_topics(course_name, week, result)
        return result
