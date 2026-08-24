"""
Vehicle module representing individual vehicles (bikes, cars, trucks)
with realistic physical and dynamic properties.
"""

from typing import Dict, Any, Optional

class Vehicle:
    """
    Represents a vehicle in the traffic simulation.
    Supports bikes, cars, and trucks with custom weights, lengths, speeds, and turn intents.
    """
    
    _id_counter = 0

    def __init__(self, v_type: str, origin_direction: str, destination_direction: str, arrival_time: float, specs: Dict[str, Any]):
        Vehicle._id_counter += 1
        self.id = Vehicle._id_counter
        self.v_type = v_type  # 'bike', 'car', 'truck'
        self.origin_direction = origin_direction  # 'N', 'S', 'E', 'W'
        self.destination_direction = destination_direction  # 'N', 'S', 'E', 'W'
        self.arrival_time = arrival_time
        
        # Physical & Performance specifications
        self.weight = specs['weight']
        self.length = specs['length']
        self.max_speed = specs['max_speed']
        self.acceleration = specs['acceleration']
        self.deceleration = specs['deceleration']
        
        # State dynamics
        self.current_speed = self.max_speed
        self.position = 0.0  # Distance along incoming lane towards stop line (meters)
        self.lane_length = 200.0  # Default incoming lane length in meters
        self.wait_time = 0.0  # Total time stopped (speed <= 0.1 m/s)
        self.travel_time = 0.0  # Total time in system
        self.is_queued = False
        self.has_departed = False
        self.departure_time: Optional[float] = None

    def update_motion(self, dt: float, distance_to_lead: float, is_green: bool):
        """
        Updates vehicle position and speed using basic car-following dynamics.
        
        Args:
            dt: Timestep duration (seconds)
            distance_to_lead: Gap to preceding vehicle or stop line (meters)
            is_green: True if traffic light for this approach is GREEN
        """
        if self.has_departed:
            return

        self.travel_time += dt

        # Stop line position is at distance = lane_length
        dist_to_stop_line = self.lane_length - self.position
        
        # Target speed determination
        if dist_to_stop_line > 0:
            if not is_green and dist_to_stop_line < 50.0 and distance_to_lead >= dist_to_stop_line:
                # Need to stop at red signal
                target_dist = dist_to_stop_line - 2.0  # Stop 2m before line
            else:
                target_dist = distance_to_lead - (self.length + 2.0)  # Safe headway gap
        else:
            # Already passed stop line
            target_dist = distance_to_lead - (self.length + 2.0)

        # Acceleration / Braking logic
        if target_dist < 1.0:
            # Need to come to a stop
            self.current_speed = max(0.0, self.current_speed - self.deceleration * dt)
        elif target_dist < 20.0:
            # Gradual slowing down
            desired_speed = min(self.max_speed, target_dist / 2.0)
            if self.current_speed > desired_speed:
                self.current_speed = max(desired_speed, self.current_speed - self.deceleration * dt)
            else:
                self.current_speed = min(desired_speed, self.current_speed + self.acceleration * dt)
        else:
            # Clear road ahead - accelerate to max speed
            self.current_speed = min(self.max_speed, self.current_speed + self.acceleration * dt)

        # Advance position
        self.position += self.current_speed * dt

        # Track queue state (stopped near/in queue)
        if self.current_speed < 0.2:
            self.wait_time += dt
            self.is_queued = True
        else:
            self.is_queued = False

        # Departure check (passed stop line + intersection zone)
        if self.position >= self.lane_length + 20.0:
            self.has_departed = True

    def __repr__(self) -> str:
        return f"<Vehicle id={self.id} type={self.v_type} origin={self.origin_direction} speed={self.current_speed:.1f} wait={self.wait_time:.1f}s>"
