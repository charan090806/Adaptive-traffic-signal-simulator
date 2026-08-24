"""
Compare Controllers module executing side-by-side benchmark runs across controllers
under identical traffic scenarios and random seeds.
"""

import pandas as pd
import numpy as np
from typing import Dict, Any, List

from simulator.intersection import Intersection
from features.traffic_features import FeatureExtractor
from controllers.fixed_controller import FixedController
from controllers.baseline_controller import BaselineMathematicalController

class ControllerBenchmarker:
    """
    Evaluates Fixed-Time and Baseline Mathematical controllers
    under identical traffic arrival sequences to guarantee fair comparisons.
    """

    def __init__(self, simulation_time: int = 1800, seed: int = 42):
        self.simulation_time = simulation_time
        self.seed = seed

    def run_benchmark(self, scenario: str = 'heavy_traffic') -> pd.DataFrame:
        """
        Runs identical traffic simulation for Fixed-Time and Baseline controllers.
        Returns comparative DataFrame with performance metrics and step-by-step history.
        """
        print(f"\n==================================================================")
        print(f" Running Controlled Benchmark: {scenario} (Seed={self.seed}, {self.simulation_time}s)")
        print(f"==================================================================")

        controllers = {
            'Fixed-Time': FixedController(fixed_green=45.0),
            'Mathematical Baseline': BaselineMathematicalController(gmin=20, gmax=120, alpha=1.0, gamma=1.5)
        }

        results = []
        histories: Dict[str, List[Dict[str, Any]]] = {}

        for name, ctrl in controllers.items():
            print(f"Simulating Controller: {name}...")
            # Instantiate fresh intersection with identical seed and scenario
            intersection = Intersection(scenario=scenario, seed=self.seed)
            extractor = FeatureExtractor()
            current_green = 30.0
            
            step_history = []

            for step in range(self.simulation_time):
                decision_point = intersection.step(dt=1.0)
                metrics = intersection.get_metrics()

                if decision_point or (step % 30 == 0 and step > 0):
                    features = extractor.update_and_extract(metrics, current_green)
                    next_g = ctrl.predict_green_time(features)
                    current_green = next_g
                    intersection.signal.set_green_time(intersection.signal.current_phase, current_green)

                # Record step log
                step_history.append({
                    'step': step,
                    'avg_wait': metrics['avg_waiting_time'],
                    'queue_length': metrics['queue_length'],
                    'avg_speed': metrics['avg_speed'],
                    'throughput': metrics['throughput'],
                    'allocated_green': current_green
                })

            final_metrics = intersection.get_metrics()
            histories[name] = step_history

            # Compute summary stats over simulation run
            waits = [h['avg_wait'] for h in step_history]
            queues = [h['queue_length'] for h in step_history]

            summary = {
                'Controller': name,
                'Scenario': scenario,
                'Average Waiting Time (s)': float(np.mean(waits)),
                'Max Waiting Time (s)': float(np.max(waits)),
                'Average Queue Length': float(np.mean(queues)),
                'Max Queue Length': float(np.max(queues)),
                'Throughput (Vehicles Served)': final_metrics['throughput'],
                'Average Speed (m/s)': final_metrics['avg_speed'],
                'Total Delay (s)': final_metrics['total_waiting_time']
            }
            results.append(summary)

        df_summary = pd.DataFrame(results)
        print("\n--- Benchmark Performance Summary Table ---")
        print(df_summary.to_string(index=False))
        print("==================================================================\n")

        return df_summary, histories

if __name__ == "__main__":
    benchmarker = ControllerBenchmarker(simulation_time=1200)
    benchmarker.run_benchmark('heavy_traffic')
