"""
Intersection module providing a complete 4-way intersection discrete-event simulator engine.
"""

import copy
from typing import Dict, List, Any, Optional
from simulator.vehicle import Vehicle
from simulator.traffic_signal import TrafficSignal
from simulator.traffic_generator import TrafficGenerator

class Intersection:
    """
    Simulates a 4-way intersection (North, South, East, West) with vehicle movement,
    queues, signal control, and performance statistics collection.
    """

    def __init__(
        self,
        scenario: str = 'medium_traffic',
        gmin: int = 30,
        gmax: int = 120,
        seed: int = 42,
        vehicle_specs: Optional[Dict[str, Any]] = None
    ):
        self.scenario = scenario
        self.seed = seed
        self.gmin = gmin
        self.gmax = gmax
        
        self.current_time = 0.0
        self.signal = TrafficSignal(gmin=gmin, gmax=gmax)
        self.generator = TrafficGenerator(scenario=scenario, seed=seed, vehicle_specs=vehicle_specs)
        
        # Vehicles organized per incoming direction approach: 'N', 'S', 'E', 'W'
        self.approaches: Dict[str, List[Vehicle]] = {
            'N': [],
            'S': [],
            'E': [],
            'W': []
        }
        
        # Statistics counters
        self.completed_vehicles: List[Vehicle] = []
        self.total_spawned_count = 0

    def step(self, dt: float = 1.0) -> bool:
        """
        Advances the simulation by dt seconds.
        
        Returns:
            bool: True if signal reached a decision boundary (end of green/yellow phase), False otherwise.
        """
        self.current_time += dt
        
        # 1. Update traffic signals
        decision_point = self.signal.update(dt)

        # 2. Spawn new vehicles according to traffic generator scenario
        new_vehicles = self.generator.step(self.current_time, dt)
        for veh in new_vehicles:
            self.approaches[veh.origin_direction].append(veh)
            self.total_spawned_count += 1

        # 3. Update vehicle movements per direction approach
        for direction, vehicles in self.approaches.items():
            is_green = self.signal.direction_lights[direction]
            
            # Sort vehicles by position (leading vehicle first)
            vehicles.sort(key=lambda v: v.position, reverse=True)
            
            remaining_vehicles: List[Vehicle] = []
            for i, veh in enumerate(vehicles):
                # Calculate distance to lead vehicle or stop line
                if i == 0:
                    distance_to_lead = 999.0  # Open road ahead
                else:
                    lead_veh = vehicles[i - 1]
                    distance_to_lead = lead_veh.position - veh.position

                veh.update_motion(dt, distance_to_lead, is_green)
                
                if veh.has_departed:
                    self.completed_vehicles.append(veh)
                else:
                    remaining_vehicles.append(veh)
                    
            self.approaches[direction] = remaining_vehicles

        return decision_point

    def get_state_metrics(self) -> Dict[str, Any]:
        """Calculates current global and directional metrics across all approaches."""
        return self.get_metrics()

    def clone(self) -> 'Intersection':
        """Deep copies simulation state for candidate green time evaluation."""
        return copy.deepcopy(self)

    def get_metrics(self) -> Dict[str, Any]:
        """
        Calculates aggregate traffic state metrics across all approaches.
        """
        total_bikes = 0
        total_cars = 0
        total_trucks = 0
        total_wait_time = 0.0
        total_speed = 0.0
        queued_count = 0
        active_count = 0
        
        dir_metrics: Dict[str, Dict[str, Any]] = {}

        for d, vehicles in self.approaches.items():
            d_bikes = sum(1 for v in vehicles if v.v_type == 'bike')
            d_cars = sum(1 for v in vehicles if v.v_type == 'car')
            d_trucks = sum(1 for v in vehicles if v.v_type == 'truck')
            d_queued = sum(1 for v in vehicles if v.is_queued)
            d_wait = sum(v.wait_time for v in vehicles)
            d_speed = sum(v.current_speed for v in vehicles) if vehicles else 0.0
            d_count = len(vehicles)
            
            total_bikes += d_bikes
            total_cars += d_cars
            total_trucks += d_trucks
            total_wait_time += d_wait
            total_speed += d_speed
            queued_count += d_queued
            active_count += d_count

            dir_metrics[d] = {
                'bikes': d_bikes,
                'cars': d_cars,
                'trucks': d_trucks,
                'total_vehicles': d_count,
                'weighted_vehicles': d_bikes + 2 * d_cars + 4 * d_trucks,
                'queue_length': d_queued,
                'waiting_time': d_wait,
                'avg_speed': (d_speed / d_count) if d_count > 0 else 0.0
            }

        total_weighted = total_bikes + (2 * total_cars) + (4 * total_trucks)
        avg_wait = (total_wait_time / active_count) if active_count > 0 else 0.0
        avg_speed = (total_speed / active_count) if active_count > 0 else 0.0

        return {
            'time_elapsed': self.current_time,
            'bikes': total_bikes,
            'cars': total_cars,
            'trucks': total_trucks,
            'total_vehicles': active_count,
            'weighted_vehicles': total_weighted,
            'queue_length': queued_count,
            'avg_queue_length': queued_count / 4.0,
            'total_waiting_time': total_wait_time,
            'avg_waiting_time': avg_wait,
            'avg_speed': avg_speed,
            'throughput': len(self.completed_vehicles),
            'directional': dir_metrics,
            'current_phase': self.signal.current_phase,
            'allocated_green': self.signal.allocated_green,
            'phase_elapsed': self.signal.phase_elapsed
        }
