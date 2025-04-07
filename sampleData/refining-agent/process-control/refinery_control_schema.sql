-- Refinery Process Control Database Schema

-- Units table stores information about refinery process units
CREATE TABLE units (
    unit_id TEXT PRIMARY KEY,
    unit_name TEXT NOT NULL,
    unit_description TEXT,
    capacity REAL,
    capacity_unit TEXT,
    commissioning_date DATE,
    last_turnaround_date DATE,
    operating_status TEXT CHECK (operating_status IN ('Running', 'Shutdown', 'Startup', 'Maintenance'))
);

-- Control loops table contains information about process control loops
CREATE TABLE control_loops (
    loop_id TEXT PRIMARY KEY,
    unit_id TEXT REFERENCES units(unit_id),
    loop_name TEXT NOT NULL,
    loop_description TEXT,
    control_type TEXT CHECK (control_type IN ('PID', 'Cascade', 'Feedforward', 'Ratio', 'Split-Range', 'Advanced')),
    controlled_variable TEXT NOT NULL,
    manipulated_variable TEXT NOT NULL,
    setpoint_value REAL,
    setpoint_unit TEXT,
    controller_mode TEXT CHECK (controller_mode IN ('Auto', 'Manual', 'Cascade')),
    kp REAL,
    ki REAL,
    kd REAL,
    scan_rate_seconds INTEGER,
    last_tuning_date DATE
);

-- Tags table for process variables
CREATE TABLE tags (
    tag_id TEXT PRIMARY KEY,
    unit_id TEXT REFERENCES units(unit_id),
    loop_id TEXT REFERENCES control_loops(loop_id),
    tag_name TEXT NOT NULL,
    tag_description TEXT,
    tag_type TEXT CHECK (tag_type IN ('AI', 'AO', 'DI', 'DO', 'PID', 'Calculated')),
    engineering_unit TEXT,
    low_limit REAL,
    high_limit REAL,
    alarm_low_low REAL,
    alarm_low REAL,
    alarm_high REAL,
    alarm_high_high REAL,
    scan_rate_seconds INTEGER
);

-- Process data table for tag historical values
CREATE TABLE process_data (
    data_id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_id TEXT REFERENCES tags(tag_id),
    timestamp DATETIME NOT NULL,
    value REAL,
    quality INTEGER CHECK (quality IN (0, 1)) -- 0 = bad quality, 1 = good quality
);

-- Alarms table for alarm events
CREATE TABLE alarms (
    alarm_id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_id TEXT REFERENCES tags(tag_id),
    timestamp_start DATETIME NOT NULL,
    timestamp_end DATETIME,
    alarm_type TEXT CHECK (alarm_type IN ('Low', 'High', 'Low Low', 'High High', 'Deviation', 'ROC', 'Diagnostic')),
    alarm_priority INTEGER CHECK (alarm_priority BETWEEN 1 AND 3), -- 1 = high, 2 = medium, 3 = low
    is_acknowledged INTEGER CHECK (is_acknowledged IN (0, 1)),
    acknowledged_by TEXT,
    acknowledged_at DATETIME
);

-- Process events table for operator actions, maintenance activities, etc.
CREATE TABLE process_events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id TEXT REFERENCES units(unit_id),
    timestamp DATETIME NOT NULL,
    event_type TEXT CHECK (event_type IN ('Operator Action', 'Maintenance', 'Process Change', 'Emergency', 'Shutdown', 'Startup')),
    event_description TEXT,
    performed_by TEXT,
    comments TEXT
);

-- Control performance metrics
CREATE TABLE control_performance (
    metric_id INTEGER PRIMARY KEY AUTOINCREMENT,
    loop_id TEXT REFERENCES control_loops(loop_id),
    evaluation_period_start DATETIME,
    evaluation_period_end DATETIME,
    time_in_control REAL, -- percentage
    standard_deviation REAL,
    mean_absolute_error REAL,
    integral_absolute_error REAL,
    oscillation_count INTEGER,
    service_factor REAL -- percentage
);

-- Sample data insertion - Units
INSERT INTO units (unit_id, unit_name, unit_description, capacity, capacity_unit, commissioning_date, last_turnaround_date, operating_status)
VALUES
('CDU-101', 'Crude Distillation Unit', 'Primary atmospheric distillation of crude oil', 100000, 'BPD', '2010-05-15', '2023-09-10', 'Running'),
('VDU-201', 'Vacuum Distillation Unit', 'Vacuum distillation of atmospheric residue', 65000, 'BPD', '2010-06-20', '2023-09-20', 'Running'),
('FCC-301', 'Fluid Catalytic Cracking Unit', 'Catalytic cracking of gas oil to gasoline and lighter products', 45000, 'BPD', '2011-03-12', '2022-04-15', 'Running'),
('HDS-401', 'Hydrodesulfurization Unit', 'Removal of sulfur from distillates', 35000, 'BPD', '2012-08-30', '2022-10-05', 'Running'),
('REF-501', 'Catalytic Reformer', 'Conversion of naphtha to high-octane reformate', 25000, 'BPD', '2011-07-18', '2023-03-22', 'Running');

-- Sample data insertion - Control Loops for CDU-101
INSERT INTO control_loops (loop_id, unit_id, loop_name, loop_description, control_type, controlled_variable, manipulated_variable, setpoint_value, setpoint_unit, controller_mode, kp, ki, kd, scan_rate_seconds, last_tuning_date)
VALUES
('TIC-101', 'CDU-101', 'Crude Preheater Temperature Control', 'Controls crude oil temperature at furnace inlet', 'PID', 'Temperature', 'Fuel gas flow', 260.0, '°C', 'Auto', 1.2, 0.5, 0.0, 1, '2023-08-15'),
('TIC-102', 'CDU-101', 'Furnace Outlet Temperature Control', 'Controls crude oil temperature at furnace outlet', 'PID', 'Temperature', 'Fuel gas flow', 355.0, '°C', 'Auto', 1.5, 0.6, 0.0, 1, '2023-08-15'),
('PIC-101', 'CDU-101', 'Column Pressure Control', 'Controls pressure at top of atmospheric column', 'PID', 'Pressure', 'Vapor flow to condenser', 1.2, 'bar', 'Auto', 2.0, 0.3, 0.0, 1, '2023-07-20'),
('FIC-101', 'CDU-101', 'Crude Feed Flow Control', 'Controls crude oil feed rate to unit', 'PID', 'Flow', 'Valve position', 400.0, 'm³/h', 'Auto', 0.8, 0.4, 0.0, 1, '2023-06-10'),
('FIC-102', 'CDU-101', 'Reflux Flow Control', 'Controls reflux flow to column top', 'PID', 'Flow', 'Valve position', 200.0, 'm³/h', 'Cascade', 0.9, 0.3, 0.0, 1, '2023-06-12'),
('LIC-101', 'CDU-101', 'Column Bottom Level Control', 'Controls liquid level at column bottom', 'PID', 'Level', 'Valve position', 50.0, '%', 'Auto', 0.5, 0.2, 0.0, 2, '2023-05-18'),
('LIC-102', 'CDU-101', 'Reflux Drum Level Control', 'Controls liquid level in overhead reflux drum', 'PID', 'Level', 'Valve position', 50.0, '%', 'Auto', 0.6, 0.25, 0.0, 2, '2023-05-18');

-- Sample data insertion - Tags for CDU-101
INSERT INTO tags (tag_id, unit_id, loop_id, tag_name, tag_description, tag_type, engineering_unit, low_limit, high_limit, alarm_low_low, alarm_low, alarm_high, alarm_high_high, scan_rate_seconds)
VALUES
('TI-101', 'CDU-101', NULL, 'Crude Inlet Temperature', 'Crude oil temperature at unit inlet', 'AI', '°C', 20.0, 40.0, 20.0, 25.0, 35.0, 40.0, 5),
('TI-102', 'CDU-101', 'TIC-101', 'Preheater Outlet Temperature', 'Crude oil temperature at preheater outlet', 'AI', '°C', 220.0, 280.0, 230.0, 240.0, 270.0, 280.0, 1),
('TI-103', 'CDU-101', 'TIC-102', 'Furnace Outlet Temperature', 'Crude oil temperature at furnace outlet', 'AI', '°C', 330.0, 370.0, 335.0, 340.0, 360.0, 365.0, 1),
('TI-104', 'CDU-101', NULL, 'Column Top Temperature', 'Temperature at top of atmospheric column', 'AI', '°C', 105.0, 130.0, 110.0, 115.0, 125.0, 128.0, 5),
('TI-105', 'CDU-101', NULL, 'Column Bottom Temperature', 'Temperature at bottom of atmospheric column', 'AI', '°C', 350.0, 380.0, 355.0, 360.0, 375.0, 378.0, 5),
('PI-101', 'CDU-101', NULL, 'Crude Feed Pressure', 'Pressure of crude oil feed', 'AI', 'bar', 4.0, 6.0, 4.2, 4.5, 5.5, 5.8, 5),
('PI-102', 'CDU-101', 'PIC-101', 'Column Top Pressure', 'Pressure at top of atmospheric column', 'AI', 'bar', 0.9, 1.5, 0.95, 1.0, 1.3, 1.4, 1),
('PI-103', 'CDU-101', NULL, 'Column Bottom Pressure', 'Pressure at bottom of atmospheric column', 'AI', 'bar', 1.1, 1.6, 1.15, 1.2, 1.5, 1.55, 5),
('FI-101', 'CDU-101', 'FIC-101', 'Crude Feed Flow Rate', 'Flow rate of crude oil feed', 'AI', 'm³/h', 350.0, 450.0, 370.0, 380.0, 420.0, 430.0, 1),
('FI-102', 'CDU-101', 'FIC-102', 'Column Reflux Flow Rate', 'Flow rate of reflux to column top', 'AI', 'm³/h', 150.0, 250.0, 170.0, 180.0, 220.0, 230.0, 1),
('LI-101', 'CDU-101', 'LIC-101', 'Column Bottom Level', 'Liquid level at column bottom', 'AI', '%', 35.0, 65.0, 40.0, 45.0, 55.0, 60.0, 2),
('LI-102', 'CDU-101', 'LIC-102', 'Reflux Drum Level', 'Liquid level in overhead reflux drum', 'AI', '%', 30.0, 70.0, 35.0, 40.0, 60.0, 65.0, 2),
('TS-101', 'CDU-101', 'TIC-101', 'Crude Preheater Temperature Setpoint', 'Setpoint for crude preheater temperature controller', 'AO', '°C', 220.0, 280.0, NULL, NULL, NULL, NULL, 1),
('TS-102', 'CDU-101', 'TIC-102', 'Furnace Outlet Temperature Setpoint', 'Setpoint for furnace outlet temperature controller', 'AO', '°C', 330.0, 370.0, NULL, NULL, NULL, NULL, 1),
('FC-101', 'CDU-101', 'FIC-101', 'Crude Feed Flow Controller Output', 'Output to crude feed control valve', 'AO', '%', 0.0, 100.0, NULL, NULL, NULL, NULL, 1),
('FC-102', 'CDU-101', 'FIC-102', 'Reflux Flow Controller Output', 'Output to reflux control valve', 'AO', '%', 0.0, 100.0, NULL, NULL, NULL, NULL, 1);

-- Sample Control Performance Metrics
INSERT INTO control_performance (loop_id, evaluation_period_start, evaluation_period_end, time_in_control, standard_deviation, mean_absolute_error, integral_absolute_error, oscillation_count, service_factor)
VALUES
('TIC-101', '2024-04-01 00:00:00', '2024-04-03 23:59:59', 95.2, 1.85, 1.23, 4362.1, 3, 99.8),
('TIC-102', '2024-04-01 00:00:00', '2024-04-03 23:59:59', 92.4, 2.31, 1.62, 5840.7, 4, 99.9),
('PIC-101', '2024-04-01 00:00:00', '2024-04-03 23:59:59', 98.1, 0.04, 0.02, 82.4, 2, 100.0),
('FIC-101', '2024-04-01 00:00:00', '2024-04-03 23:59:59', 97.3, 1.52, 1.08, 3878.4, 1, 99.7),
('FIC-102', '2024-04-01 00:00:00', '2024-04-03 23:59:59', 94.8, 2.74, 1.94, 6968.5, 5, 99.5),
('LIC-101', '2024-04-01 00:00:00', '2024-04-03 23:59:59', 96.2, 1.32, 0.89, 3184.5, 2, 100.0),
('LIC-102', '2024-04-01 00:00:00', '2024-04-03 23:59:59', 91.8, 3.28, 2.31, 8306.2, 6, 99.6);

-- Sample Process Events
INSERT INTO process_events (unit_id, timestamp, event_type, event_description, performed_by, comments)
VALUES
('CDU-101', '2024-04-02 06:00:00', 'Process Change', 'Reduced crude feed rate for upstream furnace maintenance', 'Operator Smith', 'Feed rate reduced to 385 m³/h as per Operations Manager instruction'),
('CDU-101', '2024-04-02 07:30:00', 'Operator Action', 'Increased furnace firing duty', 'Operator Johnson', 'Incremental increase to furnace duty to recover from upstream maintenance'),
('CDU-101', '2024-04-02 10:15:00', 'Maintenance', 'Crude feed control valve FV-101 calibration check', 'Technician Patel', 'Valve response found within acceptable range'),
('CDU-101', '2024-04-03 05:30:00', 'Process Change', 'Crude oil source change', 'Supervisor Wilson', 'Switched from Nigerian Bonny Light to Saudi Arabian Light crude'),
('CDU-101', '2024-04-03 06:45:00', 'Operator Action', 'Increased reflux ratio to control overhead product specifications', 'Operator Garcia', 'Response to product analysis showing heavier components'),
('CDU-101', '2024-04-03 07:15:00', 'Maintenance', 'Reflux pump switch', 'Supervisor Wilson', 'Switched from PM-102A to PM-102B due to abnormal vibration');

-- Sample Alarms (matching the alarm pattern from the process data)
INSERT INTO alarms (tag_id, timestamp_start, timestamp_end, alarm_type, alarm_priority, is_acknowledged, acknowledged_by, acknowledged_at)
VALUES
('TI-102', '2024-04-02 06:15:00', '2024-04-02 06:45:00', 'Low', 2, 1, 'Operator215', '2024-04-02 06:17:23'),
('PI-101', '2024-04-02 06:45:00', '2024-04-02 07:15:00', 'Low', 2, 1, 'Operator215', '2024-04-02 06:46:12'),
('TI-105', '2024-04-03 06:45:00', '2024-04-03 07:30:00', 'High', 2, 1, 'Operator318', '2024-04-03 06:48:35'),
('TI-104', '2024-04-03 07:00:00', '2024-04-03 07:30:00', 'High', 2, 1, 'Operator318', '2024-04-03 07:01:42'),
('PI-102', '2024-04-03 07:00:00', '2024-04-03 07:30:00', 'High', 2, 1, 'Operator318', '2024-04-03 07:02:15'),
('LI-102', '2024-04-03 07:00:00', '2024-04-03 07:45:00', 'High High', 1, 1, 'Operator318', '2024-04-03 07:03:08'); 