"""
Fixed-Time Signal Controller providing fixed pre-timed green duration.
"""

from typing import Dict, Any

class FixedController:
    """
    Fixed-time traffic signal controller using a constant pre-timed green duration (default 45s).
    """

    def __init__(self, fixed_green: float = 45.0):
        self.fixed_green = fixed_green

    def predict_green_time(self, features: Dict[str, Any]) -> float:
        """Returns constant fixed green time."""
        return self.fixed_green
