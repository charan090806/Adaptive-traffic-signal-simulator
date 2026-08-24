"""
Traffic Generator module spawning realistic vehicle arrivals based on dynamic scenarios.
"""

import random
from typing import List, Dict, Any, Optional
from simulator.vehicle import Vehicle

class TrafficGenerator:
    """
    Generates vehicle arrival streams for a 4-way intersection across 12 distinct traffic scenarios.
    """

    def __init__(self, scenario: str = 'medium_traffic', seed: int = 42, vehicle_specs: Optional[Dict[str, Any]] = None):
        self.scenario = scenario
        self.rng = random.Random(seed)
        self.vehicle_specs = vehicle_specs or {
            'bike': {'weight': 1, 'length': 2.0, 'max_speed': 10.0, 'acceleration': 2.0, 'deceleration': 3.0},
            'car': {'weight': 2, 'length': 4.5, 'max_speed': 13.9, 'acceleration': 2.5, 'deceleration': 4.5},
            'truck': {'weight': 4, 'length': 10.0, 'max_speed': 8.3, 'acceleration': 1.2, 'deceleration': 2.5}
        }
        
        # Vehicle type probability mix (default: 25% bike, 55% car, 20% truck)
        self.v_mix = [('bike', 0.25), ('car', 0.55), ('truck', 0.20)]
        
        # Directional turn distribution (70% straight, 15% left, 15% right)
        self.turn_map = {
            'N': {'straight': 'S', 'left': 'E', 'right': 'W'},
            'S': {'straight': 'N', 'left': 'W', 'right': 'E'},
            'E': {'straight': 'W', 'left': 'S', 'right': 'N'},
            'W': {'straight': 'E', 'left': 'N', 'right': 'S'}
        }

    def _get_arrival_rates(self, current_time: float) -> Dict[str, float]:
        """
        Returns arrival rates (vehicles per second) for N, S, E, W directions
        based on scenario and current simulation time.
        """
        sc = self.scenario.lower()
        
        if sc == 'low_traffic':
            rates = {'N': 0.05, 'S': 0.05, 'E': 0.05, 'W': 0.05}
        elif sc == 'medium_traffic':
            rates = {'N': 0.15, 'S': 0.15, 'E': 0.15, 'W': 0.15}
        elif sc == 'heavy_traffic':
            rates = {'N': 0.35, 'S': 0.35, 'E': 0.35, 'W': 0.35}
        elif sc == 'very_heavy_traffic':
            rates = {'N': 0.55, 'S': 0.55, 'E': 0.55, 'W': 0.55}
        elif sc == 'north_heavy':
            rates = {'N': 0.60, 'S': 0.15, 'E': 0.10, 'W': 0.10}
        elif sc == 'south_heavy':
            rates = {'N': 0.15, 'S': 0.60, 'E': 0.10, 'W': 0.10}
        elif sc == 'east_heavy':
            rates = {'N': 0.10, 'S': 0.10, 'E': 0.60, 'W': 0.15}
        elif sc == 'west_heavy':
            rates = {'N': 0.10, 'S': 0.10, 'E': 0.15, 'W': 0.60}
        elif sc == 'balanced_traffic':
            rates = {'N': 0.25, 'S': 0.25, 'E': 0.25, 'W': 0.25}
        elif sc == 'rush_hour_traffic':
            # Peak traffic in middle of simulation run
            factor = 1.0 + 2.0 * max(0.0, 1.0 - abs(current_time - 1800.0) / 1800.0)
            rates = {'N': 0.20 * factor, 'S': 0.20 * factor, 'E': 0.15 * factor, 'W': 0.15 * factor}
        elif sc == 'sudden_traffic_surge':
            # High surge between t=600 and t=1200
            if 600 <= current_time <= 1200:
                rates = {'N': 0.70, 'S': 0.70, 'E': 0.20, 'W': 0.20}
            else:
                rates = {'N': 0.10, 'S': 0.10, 'E': 0.10, 'W': 0.10}
        elif sc == 'random_traffic':
            rates = {
                'N': self.rng.uniform(0.05, 0.50),
                'S': self.rng.uniform(0.05, 0.50),
                'E': self.rng.uniform(0.05, 0.50),
                'W': self.rng.uniform(0.05, 0.50)
            }
        else:
            rates = {'N': 0.15, 'S': 0.15, 'E': 0.15, 'W': 0.15}
            
        return rates

    def step(self, current_time: float, dt: float) -> List[Vehicle]:
        """
        Generates vehicles spawned during time interval dt.
        """
        spawned_vehicles: List[Vehicle] = []
        rates = self._get_arrival_rates(current_time)

        for origin, rate in rates.items():
            # Probability of arrival in timestep dt under Poisson process
            prob = rate * dt
            if self.rng.random() < prob:
                # Pick vehicle type based on v_mix
                r_type = self.rng.random()
                if r_type < self.v_mix[0][1]:
                    v_type = 'bike'
                elif r_type < self.v_mix[0][1] + self.v_mix[1][1]:
                    v_type = 'car'
                else:
                    v_type = 'truck'
                
                # Pick route direction (70% straight, 15% left, 15% right)
                r_turn = self.rng.random()
                if r_turn < 0.70:
                    turn_type = 'straight'
                elif r_turn < 0.85:
                    turn_type = 'left'
                else:
                    turn_type = 'right'
                
                destination = self.turn_map[origin][turn_type]
                specs = self.vehicle_specs[v_type]
                
                veh = Vehicle(
                    v_type=v_type,
                    origin_direction=origin,
                    destination_direction=destination,
                    arrival_time=current_time,
                    specs=specs
                )
                spawned_vehicles.append(veh)

        return spawned_vehicles
