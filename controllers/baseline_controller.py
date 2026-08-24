"""
Baseline Controller wrapper interfacing baseline mathematical formula with closed-loop simulator.
"""

from baseline.mathematical_controller import BaselineMathematicalController

# Expose BaselineMathematicalController directly under controllers module
__all__ = ['BaselineMathematicalController']
