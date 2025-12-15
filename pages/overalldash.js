/**
 * Overall Page for Dashboard
 * @fileoverview Sub page for dashboard that gives large picture analytics for whole org
 * @author Nick Zipse <nick.zipse@rewst.com>
 * @version 1.3.3
 */

function renderDashboard() {
    try {
        // Safety check
        if (!window.dashboardData) {
            console.error('No dashboard data available');
            return;
        }

        const { workflows, executions, forms } = window.dashboardData;
        const filteredExecutions = getFilteredExecutions();

        console.log(`Rendering with ${filteredExecutions.length} executions (exclude test: ${document.getElementById('exclude-test-runs')?.checked})`);

        document.getElementById('chart-title-time').textContent = `Execution Trend (Last ${DAYS_TO_FETCH} Days)`;

        // Calculate metrics
        const totalHoursSaved = filteredExecutions.reduce((sum, exec) => {
            const secondsSaved = exec.workflow?.humanSecondsSaved || 0;
            return sum + (secondsSaved / 3600);
        }, 0);

        const monetaryValue = totalHoursSaved * 50;

        const succeededCount = filteredExecutions.filter(e =>
            e.status === 'COMPLETED' || e.status === 'SUCCESS' || e.status === 'succeeded'
        ).length;
        const failedCount = filteredExecutions.filter(e =>
            e.status === 'FAILED' || e.status === 'failed'
        ).length;
        const successRate = filteredExecutions.length > 0
            ? (succeededCount / filteredExecutions.length * 100).toFixed(1)
            : 0;

        const formSubmissions = filteredExecutions.filter(e => {
            // Skip option generators
            if (e.workflow?.type === 'OPTION_GENERATOR') return false;
            // Primary: check triggerInfo.type
            const triggerType = e.triggerInfo?.type || '';
            if (triggerType === 'Form Submission') return true;
            // Fallback: check workflow.triggers when triggerInfo times out
            if (e.workflow?.triggers) {
                const formTrigger = e.workflow.triggers.find(t =>
                    (t.triggerType?.name === 'Form Submission' || t.triggerType?.ref?.includes('form')) &&
                    t.formId
                );
                if (formTrigger) return true;
            }
            return false;
        }).length;

        const avgMinutesSaved = filteredExecutions.length > 0 ? (totalHoursSaved * 60) / filteredExecutions.length : 0;
        let metricsAnimated = false;

        // Render Metric Cards
        RewstDOM.place(RewstDOM.createMetricCard({
            title: 'Total Hours Saved',
            subtitle: 'Last ' + DAYS_TO_FETCH + ' days (all types)',
            value: formatTimeSaved(totalHoursSaved * 3600),
            icon: 'schedule',
            color: 'teal',
            trend: 'up',
            trendValue: '+12.3%',
            solidBackground: true
        }), '#metric-total-hours');
        // Animate the value

        // Set flag after animations
        window.hasInitiallyLoaded = true;
        window.hasInitiallyLoaded = true;

        RewstDOM.place(RewstDOM.createMetricCard({
            title: 'Monetary Value',
            subtitle: 'Total value at $50/hour',
            value: '$' + monetaryValue.toLocaleString('en-US', { maximumFractionDigits: 0 }),
            icon: 'attach_money',
            color: 'fandango',
            trend: 'up',
            trendValue: '+$2,400 this month',
            solidBackground: true
        }), '#metric-total-forms');

        RewstDOM.place(RewstDOM.createMetricCard({
            title: 'Success Rate',
            subtitle: 'Last ' + DAYS_TO_FETCH + ' days',
            value: successRate + '%',
            icon: 'check_circle',
            color: 'snooze',
            trend: succeededCount > failedCount ? 'up' : 'down',
            trendValue: succeededCount + ' succeeded, ' + failedCount + ' failed',
            cardClass: 'card card-accent-snooze',
            solidBackground: false
        }), '#metric-success-rate');

        RewstDOM.place(RewstDOM.createMetricCard({
            title: 'Avg. Minutes/Execution',
            subtitle: 'Per execution (' + DAYS_TO_FETCH + ' days)',
            value: avgMinutesSaved.toFixed(1),
            icon: 'trending_up',
            color: 'teal',
            trend: 'up',
            trendValue: '+0.5 min',
            cardClass: 'card card-accent-teal',
            solidBackground: false
        }), '#metric-avg-time-saved');

        RewstDOM.place(RewstDOM.createMetricCard({
            title: 'Total Form Submissions',
            subtitle: 'Last ' + DAYS_TO_FETCH + ' days',
            value: formSubmissions,
            icon: 'edit_note',
            color: 'orange',
            trend: 'up',
            trendValue: '+8 this week',
            cardClass: 'card card-accent-orange',
            solidBackground: false
        }), '#metric-form-submissions');

        RewstDOM.place(RewstDOM.createMetricCard({
            title: 'Forms Available',
            subtitle: 'Total configured forms',
            value: forms.length,
            icon: 'assignment',
            color: 'bask',
            trend: 'neutral',
            trendValue: 'Stable',
            cardClass: 'card card-accent-bask',
            solidBackground: false
        }), '#metric-form-completion');

        // Prepare execution trend data
        const executionTrendData = {};
        filteredExecutions.forEach(exec => {
            if (!exec.createdAt) return;
            const timestamp = parseInt(exec.createdAt, 10);
            if (isNaN(timestamp)) return;
            const date = new Date(timestamp);
            if (isNaN(date.getTime())) return;
            const dateStr = (date.getMonth() + 1) + '/' + date.getDate();

            if (!executionTrendData[dateStr]) {
                executionTrendData[dateStr] = {
                    total: 0,
                    succeeded: 0,
                    failed: 0,
                    sortKey: date.getTime()
                };
            }

            executionTrendData[dateStr].total++;

            if (exec.status === 'COMPLETED' || exec.status === 'SUCCESS' || exec.status === 'succeeded') {
                executionTrendData[dateStr].succeeded++;
            } else if (exec.status === 'FAILED' || exec.status === 'failed') {
                executionTrendData[dateStr].failed++;
            }
        });

        const sortedDates = Object.keys(executionTrendData).sort((a, b) =>
            executionTrendData[a].sortKey - executionTrendData[b].sortKey
        );

        const executionChartData = sortedDates.map(date => ({
            date: date,
            total: executionTrendData[date].total,
            succeeded: executionTrendData[date].succeeded,
            failed: executionTrendData[date].failed
        }));

        // Prepare task usage data
        const topChartTaskUsageData = {};

        filteredExecutions.forEach(exec => {
            if (!exec.createdAt) return;
            const timestamp = parseInt(exec.createdAt, 10);
            if (isNaN(timestamp)) return;
            const date = new Date(timestamp);
            if (isNaN(date.getTime())) return;
            const dateStr = (date.getMonth() + 1) + '/' + date.getDate();

            const triggerType = exec.triggerInfo?.type || 'Unknown';
            const tasksCompleted = exec.numSuccessfulTasks || 0;

            if (!topChartTaskUsageData[dateStr]) {
                topChartTaskUsageData[dateStr] = {
                    sortKey: date.getTime(),
                    types: {}
                };
            }

            if (!topChartTaskUsageData[dateStr].types[triggerType]) {
                topChartTaskUsageData[dateStr].types[triggerType] = 0;
            }

            topChartTaskUsageData[dateStr].types[triggerType] += tasksCompleted;
        });

        const topChartSortedTaskDates = Object.keys(topChartTaskUsageData).sort((a, b) =>
            topChartTaskUsageData[a].sortKey - topChartTaskUsageData[b].sortKey
        );

        const topChartAllTriggerTypes = [...new Set(filteredExecutions.map(e => e.triggerInfo?.type || 'Unknown'))];

        const topChartTriggerTypeColors = {
            'Form Submission': { border: RewstDOM.getColor('snooze'), bg: RewstDOM.getColorRgba('snooze', 0.1) },
            'App Platform': { border: RewstDOM.getColor('fandango'), bg: RewstDOM.getColorRgba('fandango', 0.1) },
            'Cron Job': { border: RewstDOM.getColor('teal'), bg: RewstDOM.getColorRgba('teal', 0.1) },
            'Webhook': { border: RewstDOM.getColor('orange'), bg: RewstDOM.getColorRgba('orange', 0.1) },
            'Manual/Test': { border: RewstDOM.getColor('gray'), bg: RewstDOM.getColorRgba('gray', 0.1) },
            'Unknown': { border: RewstDOM.getColor('light-gray'), bg: RewstDOM.getColorRgba('light-gray', 0.1) }
        };

        const topChartTaskDatasets = topChartAllTriggerTypes.map(triggerType => {
            const dataPoints = topChartSortedTaskDates.map(date =>
                topChartTaskUsageData[date].types[triggerType] || 0
            );
            const colors = topChartTriggerTypeColors[triggerType] || {
                border: RewstDOM.getColor('gray'),
                bg: RewstDOM.getColorRgba('gray', 0.1)
            };
            return {
                label: triggerType,
                data: dataPoints,
                borderColor: colors.border,
                backgroundColor: colors.bg,
                borderWidth: 2,
                tension: 0.4,
                fill: true
            };
        });

        // Render Execution Trend Chart
        const renderExecutionChart = () => {
            const canvas = document.createElement('canvas');
            const canvasWrapper = document.createElement('div');
            canvasWrapper.className = 'relative w-full';
            canvasWrapper.style.height = '300px';
            canvasWrapper.appendChild(canvas);

            const crosshairPlugin = {
                id: 'crosshair',
                afterDraw: (chart) => {
                    if (chart.tooltip?._active?.length) {
                        const ctx = chart.ctx;
                        const activePoint = chart.tooltip._active[0];
                        const x = activePoint.element.x;
                        
                        // Find the y scale safely
                        const yScale = chart.scales.y || Object.values(chart.scales).find(scale => scale.axis === 'y');
                        
                        if (!yScale) return; // Exit if no y scale found
                        
                        const topY = yScale.top;
                        const bottomY = yScale.bottom;
            
                        ctx.save();
                        ctx.beginPath();
                        ctx.moveTo(x, topY);
                        ctx.lineTo(x, bottomY);
                        ctx.lineWidth = 1.5;
                        ctx.strokeStyle = 'rgba(156, 163, 175, 0.6)';
                        ctx.setLineDash([4, 4]);
                        ctx.stroke();
                        ctx.restore();
                    }
                }
            };
            
            // Register it globally
            Chart.register(crosshairPlugin);


            new Chart(canvas, {
                type: 'line',
                data: {
                    labels: sortedDates,
                    datasets: [
                        {
                            label: 'Total',
                            data: executionChartData.map(d => d.total),
                            borderColor: 'rgba(0,148,144,1)',
                            backgroundColor: 'rgba(0,148,144,0.1)',
                            borderWidth: 2,
                            tension: 0.4,
                            fill: true
                        },
                        {
                            label: 'Succeeded',
                            data: executionChartData.map(d => d.succeeded),
                            borderColor: 'rgba(16,185,129,1)',
                            backgroundColor: 'rgba(16,185,129,0.1)',
                            borderWidth: 2,
                            tension: 0.4,
                            fill: true
                        },
                        {
                            label: 'Failed',
                            data: executionChartData.map(d => d.failed),
                            borderColor: 'rgba(239,68,68,1)',
                            backgroundColor: 'rgba(239,68,68,0.1)',
                            borderWidth: 2,
                            tension: 0.4,
                            fill: true
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Number of Executions',
                                font: { size: 12 }
                            }
                        }
                    },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            labels: {
                                usePointStyle: true,
                                padding: 15
                            }
                        },
                        tooltip: {
                            mode: 'index',
                            intersect: false
                        },
                        crosshair: true 
                    }
                }
            });

            document.getElementById('chart-title-time').textContent = 'Execution Trend';
            RewstDOM.place(canvasWrapper, '#chart-time-trend');
        };

        // Render task usage chart
        const renderTaskUsageChart = () => {
            const canvas = document.createElement('canvas');
            const canvasWrapper = document.createElement('div');
            canvasWrapper.className = 'relative w-full';
            canvasWrapper.style.height = '300px';
            canvasWrapper.appendChild(canvas);

            new Chart(canvas, {
                type: 'line',
                data: {
                    labels: topChartSortedTaskDates,
                    datasets: topChartTaskDatasets
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Number of Tasks Completed',
                                font: { size: 12 }
                            }
                        }
                    },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            labels: {
                                usePointStyle: true,
                                padding: 15
                            }
                        },
                        tooltip: {
                            mode: 'index',  // Show all datasets at the same x-position
                            intersect: false,  // Don't need to hover exactly on a point
                            callbacks: {
                                title: function(context) {
                                    return context[0].label;  // The date
                                }
                            }
                        },
                        crosshair: true 
                    }
                }
            });

            document.getElementById('chart-title-time').textContent = 'Task Usage by Trigger';
            RewstDOM.place(canvasWrapper, '#chart-time-trend');
        };

        // Initial render
        if (executionChartData.length > 0) {
            renderExecutionChart();
        }

        // Chart view selector
        document.getElementById('chart-view-selector').addEventListener('change', (e) => {
            if (e.target.value === 'executions') {
                renderExecutionChart();
            } else if (e.target.value === 'tasks') {
                renderTaskUsageChart();
            }
        });

        // Doughnut charts for trigger type breakdown
        const triggerTypeCounts = {};
        filteredExecutions.forEach(exec => {
            const triggerType = exec.triggerInfo?.type || 'Unknown';
            triggerTypeCounts[triggerType] = (triggerTypeCounts[triggerType] || 0) + 1;
        });

        const renderExecutionsDoughnut = () => {
            const canvas = document.createElement('canvas');
            const canvasWrapper = document.createElement('div');
            canvasWrapper.className = 'relative w-full mx-auto';
            canvasWrapper.style.height = '350px';
            canvasWrapper.style.maxWidth = '600px'; // Cap the max width so it doesn't get huge

            // Helper functions for number formatting
            function formatCenterNumber(num) {
                if (num >= 10000000) return (num / 1000000).toFixed(1) + 'M';
                if (num >= 100000) return (num / 1000).toFixed(0) + 'K';
                return num.toLocaleString();
            }

            function getCenterFontSize(num) {
                const numStr = formatCenterNumber(num);
                const length = numStr.replace(/,/g, '').length; // Count digits without commas

                if (length <= 3) return 'text-3xl sm:text-4xl'; // 1-999
                if (length <= 4) return 'text-2xl sm:text-3xl'; // 1K-9.9K or 1000-9999
                if (length <= 5) return 'text-xl sm:text-2xl'; // 10K-999K or 10000-99999
                return 'text-lg sm:text-xl'; // 1M+
            }

            canvasWrapper.appendChild(canvas);

            const labels = Object.keys(triggerTypeCounts);
            const data = Object.values(triggerTypeCounts);
            const backgroundColors = labels.map(label => {
                const colorMap = topChartTriggerTypeColors[label];
                return colorMap ? colorMap.border : RewstDOM.getColor('gray');
            });

            new Chart(canvas, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{
                        data: data,
                        backgroundColor: backgroundColors,
                        borderColor: '#ffffff',
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '70%',
                    plugins: {
                        legend: {
                            position: 'right',
                            align: 'center',
                            labels: {
                                padding: 8,
                                usePointStyle: true,
                                boxWidth: 10,
                                font: {
                                    size: 11
                                }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    const label = context.label || '';
                                    const value = context.parsed || 0;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = ((value / total) * 100).toFixed(1);
                                    return `${label}: ${value.toLocaleString()} (${percentage}%)`;
                                }
                            }
                        }
                    }
                },
                plugins: [{
                    id: 'centerText',
                    afterDraw: function (chart) {
                        const ctx = chart.ctx;
                        const centerX = (chart.chartArea.left + chart.chartArea.right) / 2;
                        const centerY = (chart.chartArea.top + chart.chartArea.bottom) / 2;

                        ctx.save();
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';

                        // Number
                        const fontSize = chart.height < 250 ? 24 : (chart.height < 350 ? 32 : 40);
                        ctx.font = `bold ${fontSize}px Poppins, sans-serif`;
                        ctx.fillStyle = '#000000';
                        ctx.fillText(formatCenterNumber(filteredExecutions.length), centerX, centerY - 10);

                        // Label
                        const labelFontSize = chart.height < 250 ? 10 : 12;
                        ctx.font = `${labelFontSize}px Poppins, sans-serif`;
                        ctx.fillStyle = '#90A4AE';
                        ctx.fillText('Total Executions', centerX, centerY + 20);

                        ctx.restore();
                    }
                }]
            });

            document.getElementById('doughnut-title').textContent = 'Executions by Trigger Type';
            RewstDOM.place(canvasWrapper, '#chart-form-types');
        };

        const renderTasksDoughnut = () => {
            const canvas = document.createElement('canvas');
            const canvasWrapper = document.createElement('div');
            canvasWrapper.className = 'relative w-full mx-auto';
            canvasWrapper.style.height = '350px';
            canvasWrapper.style.maxWidth = '600px'; // Cap the max width so it doesn't get huge

            const taskTypeData = [];
            const taskTypeTotals = {};

            filteredExecutions.forEach(exec => {
                const triggerType = exec.triggerInfo?.type || 'Unknown';
                const tasks = exec.numSuccessfulTasks || 0;
                taskTypeTotals[triggerType] = (taskTypeTotals[triggerType] || 0) + tasks;
            });

            Object.entries(taskTypeTotals).forEach(([type, count]) => {
                taskTypeData.push({ type, count });
            });

            const totalTasks = taskTypeData.reduce((sum, item) => sum + item.count, 0);
            const backgroundColors = taskTypeData.map(item => {
                const colorMap = topChartTriggerTypeColors[item.type];
                return colorMap ? colorMap.border : RewstDOM.getColor('gray');
            });

            // Helper functions for number formatting
            function formatCenterNumber(num) {
                if (num >= 10000000) return (num / 1000000).toFixed(1) + 'M';
                if (num >= 100000) return (num / 1000).toFixed(0) + 'K';
                return num.toLocaleString();
            }

            canvasWrapper.appendChild(canvas);

            new Chart(canvas, {
                type: 'doughnut',
                data: {
                    labels: taskTypeData.map(item => item.type),
                    datasets: [{
                        data: taskTypeData.map(item => item.count),
                        backgroundColor: backgroundColors,
                        borderColor: '#ffffff',
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '70%',
                    plugins: {
                        legend: {
                            position: 'right',
                            align: 'center',
                            labels: {
                                padding: 8,
                                usePointStyle: true,
                                boxWidth: 10,
                                font: {
                                    size: 11
                                }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    const label = context.label || '';
                                    const value = context.parsed || 0;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = ((value / total) * 100).toFixed(1);
                                    return `${label}: ${value.toLocaleString()} (${percentage}%)`;
                                }
                            }
                        }
                    }
                },
                plugins: [{
                    id: 'centerText',
                    afterDraw: function (chart) {
                        const ctx = chart.ctx;
                        const centerX = (chart.chartArea.left + chart.chartArea.right) / 2;
                        const centerY = (chart.chartArea.top + chart.chartArea.bottom) / 2;

                        ctx.save();
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';

                        // Number
                        const fontSize = chart.height < 250 ? 24 : (chart.height < 350 ? 32 : 40);
                        ctx.font = `bold ${fontSize}px Poppins, sans-serif`;
                        ctx.fillStyle = '#000000';
                        ctx.fillText(formatCenterNumber(totalTasks), centerX, centerY - 10);

                        // Label
                        const labelFontSize = chart.height < 250 ? 10 : 12;
                        ctx.font = `${labelFontSize}px Poppins, sans-serif`;
                        ctx.fillStyle = '#90A4AE';
                        ctx.fillText('Total Tasks', centerX, centerY + 20);

                        ctx.restore();
                    }
                }]
            });

            document.getElementById('doughnut-title').textContent = 'Tasks by Trigger Type';
            RewstDOM.place(canvasWrapper, '#chart-form-types');
        };

        // Initial doughnut render
        renderExecutionsDoughnut();

        // Doughnut view selector
        document.getElementById('doughnut-view-selector').addEventListener('change', (e) => {
            if (e.target.value === 'executions') {
                renderExecutionsDoughnut();
            } else if (e.target.value === 'tasks') {
                renderTasksDoughnut();
            }
        });

        // Top workflows table
        const workflowGroups = {};
        filteredExecutions.forEach(exec => {
            const wfName = exec.workflow?.name || 'Unknown Workflow';
            const secondsSaved = exec.workflow?.humanSecondsSaved || 0;
            const hoursSaved = secondsSaved / 3600;

            if (!workflowGroups[wfName]) {
                workflowGroups[wfName] = {
                    name: wfName,
                    workflow_id: exec.workflow?.id || null,
                    workflow_link: exec.workflow?.link || null,
                    executions: 0,
                    hours_saved: 0,
                    succeeded: 0,
                    failed: 0,
                    status: exec.workflow?.triggers?.some(t => t.enabled) ? 'Active' : 'Inactive',
                    workflow_type: exec.workflow?.type || 'STANDARD'
                };
            }
            workflowGroups[wfName].executions++;
            workflowGroups[wfName].hours_saved += hoursSaved;

            if (exec.status === 'COMPLETED' || exec.status === 'SUCCESS' || exec.status === 'succeeded') {
                workflowGroups[wfName].succeeded++;
            } else if (exec.status === 'FAILED' || exec.status === 'failed') {
                workflowGroups[wfName].failed++;
            }
        });

        const topWorkflows = Object.values(workflowGroups)
            .map(group => ({
                ...group,
                hours_saved: group.hours_saved.toFixed(1)
            }))
            .sort((a, b) => parseFloat(b.hours_saved) - parseFloat(a.hours_saved))
            .slice(0, 5);

        const workflowsTable = RewstDOM.createTable(topWorkflows, {
            title: '<span class="material-icons text-rewst-teal">emoji_events</span> Top Workflows by Time Saved',
            columns: ['name', 'workflow_type', 'hours_saved', 'executions', 'succeeded', 'failed', 'status'],
            headers: {
                name: 'Workflow Name',
                workflow_type: 'Type',
                hours_saved: 'Hours Saved',
                executions: 'Total Runs',
                succeeded: 'Succeeded',
                failed: 'Failed',
                status: 'Status'
            },
            searchable: false,
            transforms: {
                name: (value, row) => {
                    if (row.workflow_link && row.workflow_id) {
                        return '<span class="action-icons">' +
                            '<a onclick="navigateToWorkflowDetail(\'' + row.workflow_id + '\')" class="icon-action" title="View details">' +
                            '<span class="material-icons" style="font-size:16px;">visibility</span>' +
                            '</a>' +
                            '<a href="' + row.workflow_link + '" target="_blank" class="icon-action" title="Open in Rewst">' +
                            '<span class="material-icons" style="font-size:16px;">open_in_new</span>' +
                            '</a>' +
                            '</span>' +
                            '<a onclick="navigateToWorkflowDetail(\'' + row.workflow_id + '\')" class="clickable-text">' + value + '</a>';
                    }
                    return value;
                },
                workflow_type: (value) => {
                    if (value === 'OPTION_GENERATOR') {
                        return '<span class="badge badge-warning">Option Gen</span>';
                    } else if (value === 'STANDARD') {
                        return '<span class="badge badge-teal">Standard</span>';
                    }
                    return '<span class="badge">' + value + '</span>';
                },
                status: (value) => {
                    if (value === 'Active') {
                        return '<span class="badge badge-success">Active</span>';
                    } else {
                        return '<span class="badge badge-error">Inactive</span>';
                    }
                },
                succeeded: (value) => {
                    if (value > 0) {
                        return '<span class="badge badge-success">' + value + '</span>';
                    } else {
                        return '<span class="badge">' + value + '</span>';
                    }
                },
                failed: (value) => {
                    if (value > 0) {
                        return '<span class="badge badge-error">' + value + '</span>';
                    } else {
                        return '<span class="badge">' + value + '</span>';
                    }
                }
            }
        });
        RewstDOM.place(workflowsTable, '#table-top-workflows');

        // Form submissions table
        const formGroups = {};

        // Filter for form submissions with fallback to workflow.triggers when triggerInfo times out
        const filteredFormExecs = filteredExecutions.filter(e => {
            // Skip option generators
            if (e.workflow?.type === 'OPTION_GENERATOR') return false;

            // 1. Primary: check triggerInfo.type
            const triggerType = e.triggerInfo?.type || '';
            if (triggerType === 'Form Submission') return true;

            // 2. Fallback: check if workflow has a Form Submission trigger with formId
            // This catches form submissions when triggerInfo times out
            if (e.workflow?.triggers) {
                const formTrigger = e.workflow.triggers.find(t =>
                    (t.triggerType?.name === 'Form Submission' || t.triggerType?.ref?.includes('form')) &&
                    t.formId
                );
                if (formTrigger) return true;
            }

            return false;
        });

        filteredFormExecs.forEach(exec => {
            // Get formId from multiple fallback sources:
            // 1. triggerInfo.formId (from context fetch - may timeout for large datasets)
            // 2. workflow.triggers (Form Submission trigger has formId directly on execution)
            let formId = exec.triggerInfo?.formId;
            if (!formId && exec.workflow?.triggers) {
                // Find the Form Submission trigger on the workflow
                const formTrigger = exec.workflow.triggers.find(t =>
                    t.triggerType?.name === 'Form Submission' ||
                    t.triggerType?.ref?.includes('form')
                );
                if (formTrigger?.formId) {
                    formId = formTrigger.formId;
                }
            }

            // Get form name with fallback chain:
            // 0. _resolvedFormName (from async fetchMissingFormNames)
            // 1. triggerInfo.formName (from context)
            // 2. dashboardData.forms lookup by formId
            // 3. workflow name (forms from managed orgs aren't in parent's forms list)
            let formName = exec._resolvedFormName || exec.triggerInfo?.formName;
            if (!formName && formId && window.dashboardData?.forms) {
                const form = window.dashboardData.forms.find(f => f.id === formId);
                if (form?.name) formName = form.name;
            }
            // Final fallback: use workflow name (better than "Unknown Form")
            if (!formName) {
                formName = exec.workflow?.name || 'Unknown Form';
            }

            // Get form link with fallback
            let formLink = exec.triggerInfo?.formLink;
            if (!formLink && formId) {
                const orgId = exec.organization?.id || window.selectedOrg?.id;
                if (orgId) {
                    formLink = `https://app.rewst.io/organizations/${orgId}/forms/${formId}`;
                }
            }

            const workflowName = exec.workflow?.name || 'Unknown Workflow';
            const workflowLink = exec.workflow?.link;
            const secondsSaved = exec.workflow?.humanSecondsSaved || 0;
            const hoursPerRun = secondsSaved / 3600;

            const key = formName + '|' + workflowName;

            if (!formGroups[key]) {
                formGroups[key] = {
                    form_name: formName,
                    form_id: formId || null,
                    form_link: formLink,
                    workflow: workflowName,
                    workflow_link: workflowLink,
                    submissions: 0,
                    succeeded: 0,
                    failed: 0,
                    last_submitted: null,
                    total_hours_saved: 0
                };
            }

            formGroups[key].submissions++;
            formGroups[key].total_hours_saved += hoursPerRun;

            if (exec.status === 'COMPLETED' || exec.status === 'SUCCESS' || exec.status === 'succeeded') {
                formGroups[key].succeeded++;
            } else if (exec.status === 'FAILED' || exec.status === 'failed') {
                formGroups[key].failed++;
            }

            const submissionTime = parseInt(exec.createdAt, 10);
            if (!isNaN(submissionTime)) {
                const currentLast = formGroups[key].last_submitted ? parseInt(formGroups[key].last_submitted, 10) : 0;
                if (submissionTime > currentLast) {
                    formGroups[key].last_submitted = exec.createdAt;
                }
            }
        });

        const formExecs = Object.values(formGroups).map(group => ({
            ...group,
            hours_saved: (group.total_hours_saved / group.submissions).toFixed(1)
        })).sort((a, b) => b.submissions - a.submissions);

        const formSubmissionsTable = RewstDOM.createTable(
            formExecs.length > 0 ? formExecs : [{ form_name: 'No form submissions', form_id: null, form_link: null, workflow: '-', workflow_link: null, submissions: 0, succeeded: 0, failed: 0, last_submitted: null, hours_saved: '0' }],
            {
                title: '<span class="material-icons text-rewst-fandango">edit_note</span> Form Submission Summary',
                columns: ['form_name', 'workflow', 'submissions', 'succeeded', 'failed', 'last_submitted', 'hours_saved'],
                headers: {
                    form_name: 'Form Name',
                    workflow: 'Workflow',
                    submissions: 'Total',
                    succeeded: 'Succeeded',
                    failed: 'Failed',
                    last_submitted: 'Last Submitted',
                    hours_saved: 'Hours/Run'
                },
                searchable: false,
                transforms: {
                    form_name: (value, row) => {
                        if (row.form_link && row.form_id) {
                            return '<span class="action-icons">' +
                                '<a onclick="navigateToFormDetail(\'' + row.form_id + '\')" class="text-rewst-fandango hover:text-rewst-light-teal cursor-pointer" style="margin-right: 4px;" title="View details">' +
                                '<span class="material-icons" style="font-size:16px;">visibility</span>' +
                                '</a>' +
                                '<a href="' + row.form_link + '" target="_blank" class="text-rewst-fandango hover:text-rewst-light-teal cursor-pointer" style="margin-right: 4px;" title="Open in Rewst">' +
                                '<span class="material-icons" style="font-size:16px;">open_in_new</span>' +
                                '</a>' +
                                '</span>' +
                                '<a onclick="navigateToFormDetail(\'' + row.form_id + '\')" class="clickable-text">' + value + '</a>';
                        }
                        return value;
                    },
                    workflow: (value, row) => {
                        if (row.workflow_link) {
                            return '<a href="' + row.workflow_link + '" target="_blank" class="icon-action" title="Open workflow">' +
                                '<span class="material-icons" style="font-size:16px;">open_in_new</span>' +
                                '</a>' + value;
                        }
                        return value;
                    },
                    last_submitted: (value) => {
                        if (!value) return '-';
                        const timestamp = parseInt(value, 10);
                        if (isNaN(timestamp)) return 'Invalid Date';
                        const date = new Date(timestamp);
                        if (isNaN(date.getTime())) return 'Invalid Date';
                        const month = date.getMonth() + 1;
                        const day = date.getDate();
                        const year = date.getFullYear();
                        const hours = date.getHours();
                        const minutes = String(date.getMinutes()).padStart(2, '0');
                        return month + '/' + day + '/' + year + ' ' + hours + ':' + minutes;
                    },
                    succeeded: (value) => {
                        if (value > 0) {
                            return '<span class="badge badge-success">' + value + '</span>';
                        } else {
                            return '<span class="badge">' + value + '</span>';
                        }
                    },
                    failed: (value) => {
                        if (value > 0) {
                            return '<span class="badge badge-error">' + value + '</span>';
                        } else {
                            return '<span class="badge">' + value + '</span>';
                        }
                    }
                }
            }
        );
        RewstDOM.place(formSubmissionsTable, '#table-form-submissions');

        // Workflow execution summary table
        const executionGroups = {};

        filteredExecutions.forEach(exec => {
            const workflowId = exec.workflow?.id;
            const workflowName = exec.workflow?.name || 'Unknown Workflow';
            const triggerType = exec.triggerInfo?.type || 'Unknown';
            const workflowType = exec.workflow?.type || 'STANDARD';
            const groupKey = workflowName + '|' + triggerType;

            // Check if workflow exists in workflows list
            const workflowExists = workflowId ? workflows.find(w => w.id === workflowId) : null;

            if (!executionGroups[groupKey]) {
                executionGroups[groupKey] = {
                    workflow: workflowName,
                    workflow_id: workflowExists ? workflowId : null,
                    workflow_link: workflowExists ? (exec.workflow?.link || null) : null,
                    workflow_type: workflowType,
                    type: triggerType,
                    total_runs: 0,
                    succeeded: 0,
                    failed: 0,
                    total_tasks: 0,
                    total_hours_saved: 0,
                    workflow_missing: !workflowExists
                };
            }

            executionGroups[groupKey].total_runs++;
            executionGroups[groupKey].total_tasks += exec.tasksUsed || 0;

            const secondsSaved = exec.workflow?.humanSecondsSaved || 0;
            executionGroups[groupKey].total_hours_saved += secondsSaved / 3600;

            if (exec.status === 'COMPLETED' || exec.status === 'SUCCESS' || exec.status === 'succeeded') {
                executionGroups[groupKey].succeeded++;
            } else if (exec.status === 'FAILED' || exec.status === 'failed') {
                executionGroups[groupKey].failed++;
            }
        });

        const executionSummary = Object.values(executionGroups).map(group => ({
            ...group,
            hours_saved: group.total_hours_saved.toFixed(1)
        })).sort((a, b) => b.total_runs - a.total_runs);



        const executionsTable = RewstDOM.createTable(executionSummary, {
            title: '<span class="material-icons text-rewst-orange">table_chart</span> Workflow Execution Summary',
            columns: ['workflow', 'workflow_type', 'type', 'total_tasks', 'total_runs', 'succeeded', 'failed', 'hours_saved'],
            headers: {
                workflow: 'Workflow',
                workflow_type: 'Workflow Type',
                type: 'Trigger Type',
                total_tasks: 'Tasks Used',
                total_runs: 'Total Runs',
                succeeded: 'Succeeded',
                failed: 'Failed',
                hours_saved: 'Hours Saved'
            },
            filters: {
                workflow_type: { label: 'Workflow Type' },
                type: { label: 'Trigger Type' }
            },
            transforms: {
                workflow: (value, row) => {
                    // If workflow is missing, show name with badge and no icons
                    if (row.workflow_missing || (!row.workflow_link && !row.workflow_id)) {
                        return value + ' <span class="badge badge-warning ml-2" style="font-size:10px;">MISSING</span>';
                    }

                    // Normal case with icons
                    if (row.workflow_link && row.workflow_id) {
                        return '<span class="action-icons">' +
                            '<a onclick="navigateToWorkflowDetail(\'' + row.workflow_id + '\')" class="icon-action" title="View details">' +
                            '<span class="material-icons" style="font-size:16px;">visibility</span>' +
                            '</a>' +
                            '<a href="' + row.workflow_link + '" target="_blank" class="icon-action" title="Open in Rewst">' +
                            '<span class="material-icons" style="font-size:16px;">open_in_new</span>' +
                            '</a>' +
                            '</span>' +
                            '<a onclick="navigateToWorkflowDetail(\'' + row.workflow_id + '\')" class="clickable-text">' + value + '</a>';
                    }
                    return value;
                },
                workflow_type: (value) => {
                    if (value === 'OPTION_GENERATOR') {
                        return '<span class="badge badge-warning">Option Gen</span>';
                    } else if (value === 'STANDARD') {
                        return '<span class="badge badge-teal">Standard</span>';
                    }
                    return '<span class="badge">' + value + '</span>';
                },
                succeeded: (value) => {
                    if (value > 0) {
                        return '<span class="badge badge-success">' + value + '</span>';
                    } else {
                        return '<span class="badge">' + value + '</span>';
                    }
                },
                failed: (value) => {
                    if (value > 0) {
                        return '<span class="badge badge-error">' + value + '</span>';
                    } else {
                        return '<span class="badge">' + value + '</span>';
                    }
                },
                total_tasks: (value) => {
                    if (value >= 1000000) {
                        return (value / 1000000).toFixed(1) + 'M';
                    } else if (value >= 1000) {
                        return (value / 1000).toFixed(1) + 'K';
                    }
                    return value.toLocaleString();
                }
            }
        });
        RewstDOM.place(executionsTable, '#table-executions');

        // RewstDOM.showSuccess('Dashboard loaded successfully!');

    } catch (error) {
        console.error("❌ Failed to render dashboard:", error);
        RewstDOM.showError('Failed to render dashboard: ' + error.message);
    }
}