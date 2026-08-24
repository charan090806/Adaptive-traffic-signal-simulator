"""
Traffic Features module calculating baseline variables, rolling flow rates,
queue parameters, and feature vectors for machine learning.
"""

from typing import Dict, Any, List
import numpy as np

class FeatureExtractor:
    """
    Extracts and updates dynamic traffic features from simulation state history,
    matching baseline notebook definitions and providing supervised ML feature vectors.
    """

    def __init__(self):
        self.history: List[Dict[str, Any]] = []
        self.previous_green: float = 30.0

    def update_and_extract(self, intersection_metrics: Dict[str, Any], current_green: float) -> Dict[str, Any]:
        """
        Updates internal history buffer with current snapshot metrics and computes derived features.
        
        Args:
            intersection_metrics: Dictionary returned by intersection.get_metrics()
            current_green: Current allocated green time in seconds
            
        Returns:
            Dict containing all raw and derived traffic features
        """
        t = intersection_metrics['time_elapsed']
        Wt = float(intersection_metrics['weighted_vehicles'])
        Q = float(intersection_metrics['total_vehicles'])
        queue_len = float(intersection_metrics['queue_length'])
        
        # 1. Inward Flowrate (weighted vehicles / time_elapsed)
        inward_flow = Wt / max(1.0, t)
        
        # Store snapshot in history
        snapshot = {
            'time_elapsed': t,
            'bikes': intersection_metrics['bikes'],
            'cars': intersection_metrics['cars'],
            'trucks': intersection_metrics['trucks'],
            'total_vehicles': Q,
            'weighted_vehicles': Wt,
            'queue_length': queue_len,
            'inward_flow': inward_flow,
            'waiting_time': intersection_metrics['total_waiting_time'],
            'throughput': intersection_metrics['throughput']
        }
        self.history.append(snapshot)

        # 2. Expanding Average Inward Flowrate (lmd)
        inward_flows = [s['inward_flow'] for s in self.history]
        lmd = float(np.mean(inward_flows)) if inward_flows else 0.0

        # 3. Outward Flowrate & Saturation Flow (s)
        # In notebook: outward_flowrate = diff(No of Wt vehicles) / diff(time_elapsed)
        if len(self.history) > 1:
            prev_wt = self.history[-2]['weighted_vehicles']
            prev_t = self.history[-2]['time_elapsed']
            dt = max(1.0, t - prev_t)
            # Vehicles clearing intersection per second
            d_throughput = self.history[-1]['throughput'] - self.history[-2]['throughput']
            outward_flow = float(abs(prev_wt - Wt)) / dt if prev_wt > Wt else (d_throughput * 2.0 / dt)
        else:
            outward_flow = 0.0

        # Saturation flow s = expanding mean of outward flow rate (notebook default baseline range ~19.0)
        outward_flows = [s.get('outward_flow', outward_flow) for s in self.history]
        outward_flows.append(outward_flow)
        s_val = float(np.mean(outward_flows)) if outward_flows else 0.0
        # Enforce minimum saturation flow to reflect standard lane capacity (~18.0 - 20.0 veh/s)
        s_val = max(1.0, s_val)

        # 4. Baseline ratio (r = lmd / s) and clearance load (l = Wt / s)
        r_ratio = lmd / s_val
        l_load = Wt / s_val

        # 5. Additional metrics
        all_queues = [snap['queue_length'] for snap in self.history]
        max_queue = float(np.max(all_queues)) if all_queues else queue_len
        avg_queue = float(np.mean(all_queues)) if all_queues else queue_len
        
        arrival_rate = lmd
        departure_rate = outward_flow

        # Directional demands
        dir_data = intersection_metrics.get('directional', {})
        demand_ns = dir_data.get('N', {}).get('weighted_vehicles', 0) + dir_data.get('S', {}).get('weighted_vehicles', 0)
        demand_ew = dir_data.get('E', {}).get('weighted_vehicles', 0) + dir_data.get('W', {}).get('weighted_vehicles', 0)

        feature_dict = {
            'time_elapsed': t,
            'bikes': float(intersection_metrics['bikes']),
            'cars': float(intersection_metrics['cars']),
            'trucks': float(intersection_metrics['trucks']),
            'total_vehicles': Q,
            'weighted_vehicles': Wt,
            'queue_length': queue_len,
            'average_queue_length': avg_queue,
            'max_queue_length': max_queue,
            'average_speed': float(intersection_metrics['avg_speed']),
            'stopped_vehicles': queue_len,
            'waiting_time': float(intersection_metrics['total_waiting_time']),
            'average_waiting_time': float(intersection_metrics['avg_waiting_time']),
            'arrival_rate': arrival_rate,
            'departure_rate': departure_rate,
            'flow_rate': lmd,
            'saturation_flow': s_val,
            'current_green': float(current_green),
            'previous_green': float(self.previous_green),
            'elapsed_green': float(intersection_metrics.get('phase_elapsed', 0.0)),
            'traffic_density': Q / 800.0,  # 800m total intersection lane space
            'directional_demand_ns': float(demand_ns),
            'directional_demand_ew': float(demand_ew),
            'lmd': lmd,
            's': s_val,
            'r': r_ratio,
            'l': l_load,
            'Q': Q,
            'Wt': float(intersection_metrics['total_waiting_time'])  # Corrected wait time term
        }

        # Save previous green for future step
        self.previous_green = current_green
        return feature_dict
