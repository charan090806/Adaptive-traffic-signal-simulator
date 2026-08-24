"""
Main entrypoint script for the Automated Adaptive Traffic Signal Control System.
Supports mathematical baseline signal control, benchmark comparisons, and visualization generation.
"""

import argparse
import sys
import os

from controllers.fixed_controller import FixedController
from baseline.mathematical_controller import BaselineMathematicalController
from experiments.compare_controllers import ControllerBenchmarker
from visualization.plots import TrafficVisualizer

def parse_args():
    parser = argparse.ArgumentParser(description="Automated Adaptive Traffic Signal Control System (Mathematical)")
    parser.add_argument(
        '--mode',
        type=str,
        default='benchmark',
        choices=['run-fixed', 'run-baseline', 'benchmark', 'full'],
        help="Pipeline execution mode (default: benchmark)"
    )
    parser.add_argument('--scenario', type=str, default='heavy_traffic', help="Traffic scenario for evaluation")
    parser.add_argument('--sim-time', type=int, default=1800, help="Simulation duration in seconds (default: 1800)")
    parser.add_argument('--seed', type=int, default=42, help="Random seed for reproducibility")
    return parser.parse_args()


def run_pipeline(args):
    mode = args.mode

    if mode == 'run-fixed':
        print(f"\nRunning Fixed-Time Controller Simulation ({args.scenario}, {args.sim_time}s)...")
        benchmarker = ControllerBenchmarker(simulation_time=args.sim_time, seed=args.seed)
        summary_df, histories = benchmarker.run_benchmark(scenario=args.scenario)
        return

    if mode == 'run-baseline':
        print(f"\nRunning Mathematical Baseline Controller Simulation ({args.scenario}, {args.sim_time}s)...")
        benchmarker = ControllerBenchmarker(simulation_time=args.sim_time, seed=args.seed)
        summary_df, histories = benchmarker.run_benchmark(scenario=args.scenario)
        return

    if mode in ['benchmark', 'full']:
        print("\n=======================================================")
        print(" STEP 1: CONTROLLER PERFORMANCE BENCHMARK & COMPARISON")
        print("=======================================================")
        benchmarker = ControllerBenchmarker(simulation_time=args.sim_time, seed=args.seed)
        summary_df, histories = benchmarker.run_benchmark(scenario=args.scenario)

        print("\n=======================================================")
        print(" STEP 2: VISUALIZATION & COMPARATIVE CHART GENERATION")
        print("=======================================================")
        TrafficVisualizer.plot_controller_comparisons(histories)

    print("\n=======================================================")
    print(" PIPELINE EXECUTION COMPLETED SUCCESSFULLY!")
    print("=======================================================\n")

if __name__ == "__main__":
    args = parse_args()
    run_pipeline(args)

