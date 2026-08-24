"""
Baseline Mathematical Controller implementing the exact adaptive green-time formula:
  G_side = clamp(gmin + l_side + [alpha * (Q_side / s_discharge) * (1 + gamma * (lambda_in / s_out))], gmin, gmax)
"""

import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)

def calculate_baseline_green(
    gmin: float = 20.0,
    gmax: float = 120.0,
    Q: float = 0.0,
    s_out: float = 20.0,
    lmd_in: float = 15.0,
    Wt: float = 0.0,
    alpha: float = 1.0,
    gamma: float = 1.5
) -> float:
    """
    Calculates signal green time using the exact mathematical equation:
    
    1. Wt = (1 * Bikes) + (2 * Cars) + (4 * Trucks/Ambulances)
    2. l_side = Wt / s_out
    3. r_side = lambda_in / s_out
    4. s_discharge = max(0.1, s_out / 12.0)  # discharge capacity factor per 5s
    5. G_raw = gmin + l_side + alpha * (Q / s_discharge) * (1 + gamma * r_side)
    6. G_side = clamp(round(G_raw), gmin, gmax)
    """
    s_out = max(1.0, s_out)
    l_side = Wt / s_out
    r_side = lmd_in / s_out
    s_discharge = max(0.1, s_out / 12.0)

    flow_term = 1.0 + (gamma * r_side)
    queue_term = alpha * (Q / s_discharge)
    raw_G = gmin + l_side + (queue_term * flow_term)

    clamped_G = max(gmin, min(round(raw_G), gmax))
    return float(clamped_G)


class BaselineMathematicalController:
    """
    Controller wrapper executing the exact mathematical baseline formula during simulation runs.
    """

    def __init__(
        self,
        gmin: float = 20.0,
        gmax: float = 120.0,
        alpha: float = 1.0,
        gamma: float = 1.5
    ):
        self.gmin = gmin
        self.gmax = gmax
        self.alpha = alpha
        self.gamma = gamma

    def predict_green_time(self, features: Dict[str, Any]) -> float:
        """
        Extracts mathematical parameters from traffic features dictionary and returns calculated green time G.
        """
        Q = float(features.get('Q', features.get('queue_length', features.get('total_vehicles', 0.0))))
        s_out = float(features.get('s_out', features.get('s', features.get('saturation_flow', 20.0))))
        lmd_in = float(features.get('lmd_in', features.get('lmd', features.get('flow_rate', 15.0))))
        Wt = float(features.get('Wt', features.get('weighted_vehicles', 0.0)))

        return calculate_baseline_green(
            gmin=self.gmin,
            gmax=self.gmax,
            Q=Q,
            s_out=s_out,
            lmd_in=lmd_in,
            Wt=Wt,
            alpha=self.alpha,
            gamma=self.gamma
        )

