# Automated Adaptive Traffic Signal Control System

An intelligent, formula-driven adaptive traffic signal control system with 3D isometric simulation and live telemetry dashboard.

---

## 1. Project Overview & Architecture

The system implements a real-time closed-loop adaptive traffic control engine:

```
 TRAFFIC SIMULATION (4-Way N/S/E/W Intersection)
        │
        ▼
 VEHICLE & METRIC DETECTOR (Bikes=1, Cars=2, Trucks/Ambulances=4)
        │
        ▼
 FEATURE EXTRACTOR (Q, s, lmd, Wt, r, queue lengths, speeds, demands)
        │
        ▼
 CONTROLLER DECISION ENGINE
  ├── 1. Fixed-Time Pre-Timed Baseline (45s)
  └── 2. Adaptive Mathematical Formula Controller: G = l + alpha*(Q/s)*(1 + beta*(Wt/gmin) + gamma*r)
        │
        ▼
 OPTIMAL GREEN TIME ALLOCATION G (Clamped: 30s <= G <= 120s)
        │
        ▼
 TRAFFIC LIGHT STATE UPDATE, FCFS AMBULANCE PREEMPTION & VEHICLE MOVEMENT
```

---

## 2. Directory Structure

```
SIHsimupdated/
├── config.py                         # Central configuration parameters
├── requirements.txt                  # Dependency list
├── README.md                         # Documentation
├── main.py                           # CLI entrypoint for simulations & benchmarking
├── server.py                         # Standalone HTTP Server for 3D Web Simulator
├── simulator/                        # 4-way intersection simulation engine
│   ├── vehicle.py
│   ├── traffic_signal.py
│   ├── intersection.py
│   └── traffic_generator.py          # 12 dynamic traffic scenarios
├── features/                         # Dynamic traffic feature extractor
│   └── traffic_features.py
├── baseline/                         # Baseline mathematical formula controller
│   └── mathematical_controller.py
├── controllers/                      # Signal controllers
│   ├── fixed_controller.py
│   └── baseline_controller.py
├── visualization/                    # Dashboard and comparison charts
│   ├── dashboard.py                  # Terminal status viewer
│   ├── plots.py                      # Comparative Matplotlib visualizer
│   └── output_plots/                 # Generated benchmark charts
└── web_simulator/                    # 3D Three.js + Chart.js Web Simulator
    ├── index.html                    # Visualizer & Telemetry UI
    ├── package.json
    ├── src/
    │   ├── main.js                   # 3D scene, continuous physics & FCFS emergency queue
    │   └── style.css
    └── dist/                         # Production build assets
```

---

## 3. Mathematical Model & Exact Adaptive Formula

$$G_{\text{side}} = \text{clamp}\left(g_{\text{min}} + l_{\text{side}} + \left[\alpha \cdot \left(\frac{Q_{\text{side}}}{s_{\text{discharge}}}\right) \cdot \left(1 + \gamma \cdot \frac{\lambda_{\text{in}}}{s_{\text{out}}}\right)\right], \; g_{\text{min}}, \; g_{\text{max}}\right)$$

### Step-by-Step Mathematical Breakdown:
1. **Weighted Vehicle Load ($W_t$)**:
   $$W_t = (1 \times \text{Bikes}) + (2 \times \text{Cars}) + (4 \times \text{Trucks / Ambulances})$$
2. **Clearance Load Parameter ($l_{\text{side}}$)**:
   $$l_{\text{side}} = \frac{W_t}{s_{\text{out}}}$$
3. **Flow Ratio ($r_{\text{side}}$)**:
   $$r_{\text{side}} = \frac{\lambda_{\text{in}}}{s_{\text{out}}}$$
4. **Discharge Capacity Rate ($s_{\text{discharge}}$)**:
   $$s_{\text{discharge}} = \frac{s_{\text{out}}}{12.0} \quad (\approx 1.67 \text{ vehs per 5s interval for } s_{\text{out}} = 20)$$
5. **Raw Green Allocation ($G_{\text{raw}}$)**:
   $$G_{\text{raw}} = g_{\text{min}} + l_{\text{side}} + \underbrace{\alpha \cdot \left(\frac{Q_{\text{side}}}{s_{\text{discharge}}}\right)}_{\text{Queue Clearance Time}} \cdot \underbrace{\left(1 + \gamma \cdot r_{\text{side}}\right)}_{\text{Arrival Demand Multiplier}}$$
6. **Safety Range Clamping**:
   $$G = \max\Big(g_{\text{min}}, \; \min\big(\text{round}(G_{\text{raw}}), \; g_{\text{max}}\big)\Big)$$

### Default Parameters:
* $g_{\text{min}} = 20\text{s}$ (adjustable 10–60s)
* $g_{\text{max}} = 120\text{s}$
* $\alpha = 1.0$ (Queue clearance factor)
* $\gamma = 1.5$ (Demand flow ratio factor)
* $\lambda_{\text{in}} = 15\text{ veh/min}$
* $s_{\text{out}} = 20\text{ veh/min}$


---

## 4. Usage & Example Commands

### Install Dependencies
```bash
pip install -r requirements.txt
```

### Launch 3D Web Simulator
```bash
python server.py
```
Open **http://localhost:8000** in your browser.

### Run Performance Benchmark (Fixed-Time vs Mathematical Baseline)
```bash
python main.py --mode benchmark --scenario heavy_traffic --sim-time 1800
```

