"""
Plots module creating publication-quality charts comparing controllers, feature importances,
and model residual errors.
"""

import os
import matplotlib.pyplot as plt
import seaborn as sns
import pandas as pd
import numpy as np
from typing import Dict, List, Any
from config import PROJECT_ROOT

sns.set_theme(style="whitegrid", palette="muted")
FIG_DIR = os.path.join(PROJECT_ROOT, "visualization", "output_plots")
os.makedirs(FIG_DIR, exist_ok=True)

class TrafficVisualizer:
    """
    Generates comparative plot figures for benchmarking report.
    """

    @staticmethod
    def plot_controller_comparisons(histories: Dict[str, List[Dict[str, Any]]], save_dir: str = FIG_DIR):
        """
        Generates line plots for Waiting Time, Queue Length, and Throughput over time.
        """
        fig, axes = plt.subplots(3, 1, figsize=(12, 14), sharex=True)

        colors = {'Fixed-Time': '#e74c3c', 'Mathematical Baseline': '#3498db', 'Supervised ML': '#2ecc71'}

        for name, history in histories.items():
            df_h = pd.DataFrame(history)
            color = colors.get(name, '#9b59b6')

            # 1. Waiting Time vs Time
            axes[0].plot(df_h['step'], df_h['avg_wait'], label=name, color=color, linewidth=2)
            
            # 2. Queue Length vs Time
            axes[1].plot(df_h['step'], df_h['queue_length'], label=name, color=color, linewidth=2)
            
            # 3. Throughput vs Time
            axes[2].plot(df_h['step'], df_h['throughput'], label=name, color=color, linewidth=2)

        axes[0].set_ylabel("Avg Waiting Time (s)", fontsize=12, fontweight='bold')
        axes[0].set_title("Average Vehicle Waiting Time Over Simulation Run", fontsize=14, fontweight='bold')
        axes[0].legend(loc='upper right', frameon=True)
        axes[0].grid(True, linestyle='--', alpha=0.6)

        axes[1].set_ylabel("Queue Length (vehicles)", fontsize=12, fontweight='bold')
        axes[1].set_title("Intersection Queue Length Over Simulation Run", fontsize=14, fontweight='bold')
        axes[1].legend(loc='upper right', frameon=True)
        axes[1].grid(True, linestyle='--', alpha=0.6)

        axes[2].set_ylabel("Cumulative Served Vehicles", fontsize=12, fontweight='bold')
        axes[2].set_xlabel("Simulation Step (seconds)", fontsize=12, fontweight='bold')
        axes[2].set_title("Cumulative Vehicle Throughput", fontsize=14, fontweight='bold')
        axes[2].legend(loc='lower right', frameon=True)
        axes[2].grid(True, linestyle='--', alpha=0.6)

        plt.tight_layout()
        out_path = os.path.join(save_dir, "controller_comparisons.png")
        plt.savefig(out_path, dpi=300)
        plt.close()
        print(f"Saved comparative performance chart to {out_path}")

    @staticmethod
    def plot_baseline_vs_ml_green(df_dataset: pd.DataFrame, save_dir: str = FIG_DIR):
        """
        Generates scatter/line plot comparing Baseline G vs Optimal / Predicted ML G.
        """
        if 'baseline_G' not in df_dataset.columns or 'optimal_G' not in df_dataset.columns:
            return

        plt.figure(figsize=(10, 6))
        sample_df = df_dataset.head(200).reset_index()

        plt.plot(sample_df.index, sample_df['baseline_G'], label='Mathematical Baseline G', color='#3498db', linestyle='--', linewidth=2)
        plt.plot(sample_df.index, sample_df['optimal_G'], label='Target Optimal G', color='#2ecc71', linewidth=2.5)

        plt.xlabel("Sample Decision Boundary Index", fontsize=12, fontweight='bold')
        plt.ylabel("Allocated Green Time G (seconds)", fontsize=12, fontweight='bold')
        plt.title("Mathematical Baseline G vs Target Optimal G Comparison", fontsize=14, fontweight='bold')
        plt.legend(loc='upper right', frameon=True)
        plt.grid(True, linestyle='--', alpha=0.6)

        plt.tight_layout()
        out_path = os.path.join(save_dir, "baseline_vs_ml_green.png")
        plt.savefig(out_path, dpi=300)
        plt.close()
        print(f"Saved baseline vs ML green plot to {out_path}")

    @staticmethod
    def plot_feature_importance(importance_df: pd.DataFrame, save_dir: str = FIG_DIR):
        """
        Generates horizontal bar chart of ML model feature importances.
        """
        plt.figure(figsize=(10, 8))
        top_df = importance_df.head(15)

        sns.barplot(x='importance', y='feature', data=top_df, palette='viridis')

        plt.xlabel("Feature Importance Weight", fontsize=12, fontweight='bold')
        plt.ylabel("Traffic Feature", fontsize=12, fontweight='bold')
        plt.title("Top Feature Importances in Machine Learning Signal Controller", fontsize=14, fontweight='bold')
        plt.tight_layout()

        out_path = os.path.join(save_dir, "feature_importance.png")
        plt.savefig(out_path, dpi=300)
        plt.close()
        print(f"Saved feature importance plot to {out_path}")
