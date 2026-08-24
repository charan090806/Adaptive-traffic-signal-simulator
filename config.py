"""
Central Configuration File for Automated Adaptive Traffic Signal Control System.
Contains all global simulation, traffic, baseline mathematical model, ML, and evaluation parameters.
"""

import os

# Base paths
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
VISUALIZATION_DIR = os.path.join(PROJECT_ROOT, "visualization", "output_plots")
os.makedirs(VISUALIZATION_DIR, exist_ok=True)

# Simulation Parameters
SIMULATION_TIME = 3600  # Total simulation time in seconds per run
TIME_STEP = 1           # Discrete timestep in seconds
DECISION_INTERVAL = 30  # Interval (seconds) between traffic signal re-evaluations

# Signal Limits (seconds)
GMIN = 30
GMAX = 120

# Baseline Formula Parameters (Notebook default baseline assumptions)
ALPHA = 1.0
BETA = 1.2
GAMMA = 1.5

# Vehicle Configuration
VEHICLE_SPECS = {
    'bike': {
        'weight': 1,
        'length': 2.0,       # meters
        'max_speed': 10.0,   # m/s (~36 km/h)
        'acceleration': 2.0, # m/s^2
        'deceleration': 3.0  # m/s^2
    },
    'car': {
        'weight': 2,
        'length': 4.5,       # meters
        'max_speed': 13.9,   # m/s (~50 km/h)
        'acceleration': 2.5, # m/s^2
        'deceleration': 4.5  # m/s^2
    },
    'truck': {
        'weight': 4,
        'length': 10.0,      # meters
        'max_speed': 8.3,    # m/s (~30 km/h)
        'acceleration': 1.2, # m/s^2
        'deceleration': 2.5  # m/s^2
    }
}

# Machine Learning Parameters
DATASET_SIZE = 10000     # Default dataset size
RANDOM_SEED = 42         # Seed for reproducibility
TRAIN_RATIO = 0.70
VAL_RATIO = 0.15
TEST_RATIO = 0.15

# Candidate Green Times for Simulator-based Optimization (seconds)
G_CANDIDATES = [30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100, 110, 120]

# Optimization Cost Objective Weights
COST_WEIGHTS = {
    'w_wait': 0.40,
    'w_queue': 0.30,
    'w_maxqueue': 0.15,
    'w_throughput': 0.15
}

# Supported Traffic Scenarios
TRAFFIC_SCENARIOS = [
    'low_traffic',
    'medium_traffic',
    'heavy_traffic',
    'very_heavy_traffic',
    'north_heavy',
    'south_heavy',
    'east_heavy',
    'west_heavy',
    'balanced_traffic',
    'rush_hour_traffic',
    'random_traffic',
    'sudden_traffic_surge'
]
