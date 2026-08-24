"""
Dashboard module providing terminal/ASCII visual status layout of the 4-way intersection.
"""

from typing import Dict, Any

class IntersectionDashboard:
    """
    Renders live ASCII terminal display of intersection simulation state.
    """

    @staticmethod,
    def render(metrics: Dict[str, Any], controller_name: str = "ML Controller"):
        """
        Prints formatted text/ASCII visualization of current intersection state.
        """
        dirs = metrics.get('directional', {})
        n_info = dirs.get('N', {})
        s_info = dirs.get('S', {})
        e_info = dirs.get('E', {})
        w_info = dirs.get('W', {})

        phase_str = "N-S GREEN" if metrics['current_phase'] == 0 else "E-W GREEN"

        output = f"""
========================================================================
           TRAFFIC CONTROL SIMULATOR - LIVE STATUS
========================================================================
 Active Controller: {controller_name}
 Simulation Time  : {metrics['time_elapsed']}s
 Signal Phase     : {phase_str} (Allocated Green: {metrics['allocated_green']}s)
 Total Served     : {metrics['throughput']} vehicles
------------------------------------------------------------------------
                       NORTH APPROACH
                  Vehicles: {n_info.get('total_vehicles', 0)} | Queue: {n_info.get('queue_length', 0)}
                  (B:{n_info.get('bikes', 0)} C:{n_info.get('cars', 0)} T:{n_info.get('trucks', 0)})
                       |    |
                       | v  |
                       |    |
WEST APPROACH          |    |          EAST APPROACH
Vehicles: {w_info.get('total_vehicles', 0)}            +----+            Vehicles: {e_info.get('total_vehicles', 0)}
Queue   : {w_info.get('queue_length', 0)}    ----->  |    |  <-----    Queue   : {e_info.get('queue_length', 0)}
(B:{w_info.get('bikes', 0)} C:{w_info.get('cars', 0)} T:{w_info.get('trucks', 0)})    +----+            (B:{e_info.get('bikes', 0)} C:{e_info.get('cars', 0)} T:{e_info.get('trucks', 0)})
                       |    |
                       |  ^ |
                       |    |
                       SOUTH APPROACH
                  Vehicles: {s_info.get('total_vehicles', 0)} | Queue: {s_info.get('queue_length', 0)}
                  (B:{s_info.get('bikes', 0)} C:{s_info.get('cars', 0)} T:{s_info.get('trucks', 0)})
------------------------------------------------------------------------
 System Stats:
   - Total Queue       : {metrics['queue_length']}
   - Avg Waiting Time  : {metrics['avg_waiting_time']:.1f} s
   - Avg Speed         : {metrics['avg_speed']:.1f} m/s
========================================================================
"""
        print(output)
