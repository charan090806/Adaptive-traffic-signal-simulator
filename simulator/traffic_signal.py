"""
Traffic Signal module managing phases, yellow intervals, and green time allocations.
"""

from typing import Dict

class TrafficSignal:
    """
    Manages green, yellow, and red states across directional approaches.
    Phases:
      0: North-South Green (N, S green; E, W red)
      1: North-South Yellow
      2: East-West Green (E, W green; N, S red)
      3: East-West Yellow
    """
    
    def __init__(self, gmin: int = 30, gmax: int = 120, yellow_time: int = 3):
        self.gmin = gmin
        self.gmax = gmax
        self.yellow_time = yellow_time
        
        self.current_phase = 0  # Start with NS Green
        self.phase_elapsed = 0.0
        self.allocated_green = float(gmin)
        self.is_yellow = False
        
        # Directional light statuses: True = GREEN, False = RED
        self.direction_lights: Dict[str, bool] = {
            'N': True,
            'S': True,
            'E': False,
            'W': False
        }

    def set_green_time(self, phase: int, duration: float):
        """Sets allocated green time clamped between gmin and gmax."""
        clamped_duration = float(max(self.gmin, min(int(duration), self.gmax)))
        self.allocated_green = clamped_duration

    def update(self, dt: float) -> bool:
        """
        Advances signal timer by dt seconds.
        Returns True if a phase change/decision point has just been reached.
        """
        self.phase_elapsed += dt
        
        if not self.is_yellow:
            # Main Green phase
            if self.phase_elapsed >= self.allocated_green:
                # Transition to Yellow
                self.is_yellow = True
                self.phase_elapsed = 0.0
                return False
        else:
            # Yellow phase
            if self.phase_elapsed >= self.yellow_time:
                # Switch to next main phase
                self.is_yellow = False
                self.phase_elapsed = 0.0
                self.current_phase = (self.current_phase + 2) % 4  # Toggle 0 <-> 2
                self._update_lights()
                return True  # Decision point for next phase green allocation

        self._update_lights()
        return False

    def _update_lights(self):
        """Updates green status for each direction based on phase and yellow state."""
        if self.is_yellow:
            # Yellow phase: all lights caution/red for safety buffer
            self.direction_lights = {'N': False, 'S': False, 'E': False, 'W': False}
        else:
            if self.current_phase == 0:
                # N-S Green
                self.direction_lights = {'N': True, 'S': True, 'E': False, 'W': False}
            else:
                # E-W Green
                self.direction_lights = {'N': False, 'S': False, 'E': True, 'W': True}

    def get_active_directions(self) -> list:
        """Returns directions currently having a GREEN signal."""
        return [d for d, status in self.direction_lights.items() if status]

    def __repr__(self) -> str:
        state_str = "YELLOW" if self.is_yellow else "GREEN"
        phase_name = "N-S" if self.current_phase == 0 else "E-W"
        return f"<TrafficSignal phase={phase_name} state={state_str} elapsed={self.phase_elapsed:.1f}/{self.allocated_green}s>"
