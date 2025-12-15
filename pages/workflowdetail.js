/**
 * Workflow Details Dashboard Page
 * @fileoverview Sub page for dashboard for workflow specific detailed analytics
 * @author Nick Zipse <nick.zipse@rewst.com>
 * @version 1.3.3
 */

/* ============================================================
 * UNIVERSAL TIME FORMATTING HELPER
 * Formats seconds into human-readable time with proper units
 * ============================================================ */
function formatTimeSaved(seconds) {
  const s = parseFloat(seconds || 0);
  if (!s || s === 0) return '—';
  
  // Less than 1 minute: show seconds
  if (s < 60) {
    return s.toFixed(1) + 's';
  }
  
  // Less than 1 hour: show minutes
  const minutes = s / 60;
  if (minutes < 60) {
    return minutes.toFixed(1) + 'm';
  }
  
  // 1+ hours: show hours with comma formatting for thousands
  const hours = minutes / 60;
  if (hours < 1000) {
    return hours.toFixed(1) + 'h';
  }
  
  // Thousands of hours: add commas
  return hours.toLocaleString('en-US', { 
    minimumFractionDigits: 1, 
    maximumFractionDigits: 1 
  }) + 'h';
}

function renderWorkflowDetailsDashboard() {
  if (!window.dashboardData || !window.dashboardData.workflows) {
    console.error("No dashboard data available");
    return;
  }

  const { workflows } = window.dashboardData;

  // If already initialized and we have a selected workflow, just re-render it with new filters
  if (window.workflowSelectorInitialized) {
    if (window.selectedWorkflow) {
      const filteredExecutions = getFilteredExecutions();
      
      // Trigger fade animation on the display area
      const displayArea = document.getElementById("workflow-display-area");
      if (displayArea) {
        displayArea.style.animation = 'none';
        displayArea.offsetHeight; // Trigger reflow
        displayArea.style.animation = 'fadeInUp 0.4s ease-out';
      }
      
      renderSelectedWorkflow(window.selectedWorkflow, filteredExecutions);
    }
    return;
  }

  const selectorEl = document.getElementById("workflow-selector");
  if (!selectorEl) {
    console.error("workflow-selector element not found!");
    return;
  }

  const autocomplete = RewstDOM.createAutocomplete(workflows, {
    labelKey: "name",
    valueKey: "id",
    placeholder: "Search for a workflow...",
    maxResults: workflows.length,
    onSelect: (workflow) => {
      const filteredExecutions = getFilteredExecutions();
      renderSelectedWorkflow(workflow, filteredExecutions);
    },
  });

  RewstDOM.place(autocomplete, "#workflow-selector");
  window.workflowSelectorInitialized = true;
  console.log("✅ Workflow selector initialized");
}

/**
 * Handle selected workflow
 */
function renderSelectedWorkflow(workflow, executions) {
  // Store for re-rendering on filter changes
  window.selectedWorkflow = workflow;

  console.log("Selected workflow:", workflow.name);

  const displayArea = document.getElementById("workflow-display-area");
  displayArea.style.display = "block";

  document.getElementById("selected-workflow-name").textContent = workflow.name;
  document.getElementById("selected-workflow-link").href = workflow.link || `https://app.rewst.io/workflows/${workflow.id}`;

  const workflowExecutions = executions.filter(
    (e) => e.workflow?.id === workflow.id
  );

  console.log(`Found ${workflowExecutions.length} executions for this workflow`);

  renderWorkflowMetrics(workflowExecutions);
  renderWorkflowTimeline(workflowExecutions);
  renderWorkflowFailures(workflowExecutions);
  renderWorkflowExecutionsTable(workflowExecutions);
}

/**
 * Render metric cards
 */
function renderWorkflowMetrics(execs) {
  const totalExecutions = execs.length;
  const succeededExecutions = execs.filter((e) =>
    ["succeeded", "SUCCEEDED", "COMPLETED", "SUCCESS"].includes(e.status)
  ).length;
  const failedExecutions = execs.filter((e) =>
    ["FAILED", "failed"].includes(e.status)
  ).length;

  const successRate =
    totalExecutions > 0
      ? ((succeededExecutions / totalExecutions) * 100).toFixed(1)
      : 0;
  const failureRate =
    totalExecutions > 0
      ? ((failedExecutions / totalExecutions) * 100).toFixed(1)
      : 0;

  const totalSecondsSaved = execs.reduce(
    (sum, e) => sum + (e.humanSecondsSaved || 0),
    0
  );
  const hoursSaved = totalSecondsSaved / 3600;
  const monetaryValue = (hoursSaved * 50).toFixed(0);
  const totalTasksUsed = execs.reduce(
    (sum, e) => sum + (e.tasksUsed || 0),
    0
  );

  const runtimes = execs
    .filter((e) => e.createdAt && e.updatedAt)
    .map((e) => parseInt(e.updatedAt) - parseInt(e.createdAt));
  const avgRuntime =
    runtimes.length > 0
      ? (runtimes.reduce((a, b) => a + b, 0) / runtimes.length / 1000).toFixed(1)
      : 0;

  // Use formatTimeSaved for the time saved metric
  RewstDOM.loadMetricCard("#workflow-metric-time", {
    title: "Time Saved",
    subtitle: "Total hours for this workflow",
    value: formatTimeSaved(totalSecondsSaved),
    icon: "schedule",
    color: "teal",
    solidBackground: true,
  });

  RewstDOM.loadMetricCard("#workflow-metric-value", {
    title: "Monetary Value",
    subtitle: "At $50/hour",
    value: "$" + parseInt(monetaryValue).toLocaleString(),
    icon: "attach_money",
    color: "fandango",
    solidBackground: true,
  });

  RewstDOM.loadMetricCard("#workflow-metric-tasks", {
    title: "Total Task Usage",
    subtitle: totalExecutions + " executions",
    value: totalTasksUsed.toLocaleString(),
    icon: "task_alt",
    color: "snooze",
    cardClass: "card card-accent-snooze",
    solidBackground: false,
  });

  RewstDOM.loadMetricCard("#workflow-metric-success", {
    title: "Success Rate",
    subtitle: succeededExecutions + " succeeded",
    value: successRate + "%",
    icon: "check_circle",
    color: "teal",
    cardClass: "card card-accent-teal",
    solidBackground: false,
  });

  RewstDOM.loadMetricCard("#workflow-metric-failures", {
    title: "Failure Rate",
    subtitle: failedExecutions + " failed",
    value: failureRate + "%",
    icon: "error",
    color: "error",
    cardClass: "card card-accent-error",
    solidBackground: false,
  });

  RewstDOM.loadMetricCard("#workflow-metric-runtime", {
    title: "Avg Runtime",
    subtitle: "Average execution time",
    value: avgRuntime + "s",
    icon: "timer",
    color: "fandango",
    cardClass: "card card-accent-fandango",
    solidBackground: false,
  });
}

/**
 * Render timeline chart (executions vs tasks)
 */
function renderWorkflowTimeline(execs) {
  const executionsByDay = {};
  const tasksByDay = {};

  execs.forEach((exec) => {
    const date = new Date(parseInt(exec.createdAt));
    const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
    if (!executionsByDay[dateStr]) {
      executionsByDay[dateStr] = { succeeded: 0, failed: 0, sortKey: date.getTime() };
      tasksByDay[dateStr] = { tasks: 0, sortKey: date.getTime() };
    }

    if (["succeeded", "SUCCEEDED", "COMPLETED", "SUCCESS"].includes(exec.status))
      executionsByDay[dateStr].succeeded++;
    if (["FAILED", "failed"].includes(exec.status))
      executionsByDay[dateStr].failed++;

    tasksByDay[dateStr].tasks += exec.tasksUsed || 0;
  });

  const sortedDates = Object.keys(executionsByDay).sort(
    (a, b) => executionsByDay[a].sortKey - executionsByDay[b].sortKey
  );
  const succeededData = sortedDates.map((d) => executionsByDay[d].succeeded);
  const failedData = sortedDates.map((d) => executionsByDay[d].failed);
  const taskChartData = sortedDates.map((d) => tasksByDay[d].tasks);

  document.getElementById("workflow-timeline").innerHTML = `
    <div class="card p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-semibold text-rewst-black">Timeline</h3>
        <select id="workflow-timeline-toggle" class="input-field py-1 px-3 border border-gray-200 rounded-md">
          <option value="executions">Executions</option>
          <option value="tasks">Task Usage</option>
        </select>
      </div>
      <div id="workflow-timeline-chart"></div>
    </div>
  `;

  const renderChart = (type) => {
    const canvas = document.createElement("canvas");
    const wrapper = document.createElement("div");
    wrapper.className = "relative w-full";
    wrapper.style.height = "300px";
    wrapper.appendChild(canvas);

    const datasets =
      type === "executions"
        ? [
            {
              label: "Succeeded",
              data: succeededData,
              borderColor: "rgba(16,185,129,1)",
              backgroundColor: "rgba(16,185,129,0.1)",
              borderWidth: 2,
              tension: 0.4,
              fill: true,
            },
            {
              label: "Failed",
              data: failedData,
              borderColor: "rgba(239,68,68,1)",
              backgroundColor: "rgba(239,68,68,0.1)",
              borderWidth: 2,
              tension: 0.4,
              fill: true,
            },
          ]
        : [
            {
              label: "Tasks",
              data: taskChartData,
              borderColor: "rgba(0,148,144,1)",
              backgroundColor: "rgba(0,148,144,0.1)",
              borderWidth: 2,
              tension: 0.4,
              fill: true,
            },
          ];

    new Chart(canvas, {
      type: "line",
      data: { labels: sortedDates, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: type === "executions" ? "Number of Executions" : "Number of Tasks",
            },
          },
        },
        plugins: {
          legend: {
            display: true,
            position: "top",
            labels: { usePointStyle: true, padding: 15 },
          },
        },
      },
    });

    RewstDOM.place(wrapper, "#workflow-timeline-chart");
  };

  renderChart("executions");
  document
    .getElementById("workflow-timeline-toggle")
    .addEventListener("change", (e) => renderChart(e.target.value));
}

/**
 * Render failures table
 */
function renderWorkflowFailures(execs) {
  const failed = execs.filter((e) => ["FAILED", "failed"].includes(e.status));
  const target = document.getElementById("workflow-failures");

  if (failed.length === 0) {
    target.innerHTML = "";
    return;
  }

  const failureData = failed
    .sort((a, b) => parseInt(b.createdAt) - parseInt(a.createdAt))
    .slice(0, 10)
    .map((e) => ({
      execution_id: e.id,
      execution_link: e.link,
      timestamp: new Date(parseInt(e.createdAt)).toLocaleString(),
      status: e.status,
      runtime:
        e.createdAt && e.updatedAt
          ? ((parseInt(e.updatedAt) - parseInt(e.createdAt)) / 1000)
          : null,
      trigger_type: e.triggerInfo?.type || "Unknown",
    }));

  const table = RewstDOM.createTable(failureData, {
    title: '<span class="material-icons text-red-600">priority_high</span> Recent Failures',
    columns: ["execution_id", "timestamp", "status", "runtime", "trigger_type"],
    transforms: {
      execution_id: (value, row) =>
        `<a href="${row.execution_link}" target="_blank" class="flex items-center gap-2 text-rewst-teal hover:text-rewst-light-teal"><span class="material-icons" style="font-size:16px;">open_in_new</span><span>View execution</span></a>`,
      status: () => '<span class="badge badge-error">FAILED</span>',
    },
  });

  RewstDOM.place(table, "#workflow-failures");
}

/**
 * Render recent executions table
 */
function renderWorkflowExecutionsTable(execs) {
  const recentExecs = execs
    .sort((a, b) => parseInt(b.createdAt) - parseInt(a.createdAt))
    .slice(0, 100);

  const data = recentExecs.map((e) => ({
    execution_id: e.id,
    execution_link: e.link,
    timestamp: parseInt(e.createdAt), // KEEP RAW TIMESTAMP HERE
    status: e.status,
    organization: e.organization?.name || "Unknown",
    tasks_used: e.tasksUsed || 0,
    runtime:
      e.createdAt && e.updatedAt
        ? ((parseInt(e.updatedAt) - parseInt(e.createdAt)) / 1000).toFixed(1)
        : 0, // KEEP RAW NUMBER, NO "s"
    trigger_type: e.triggerInfo?.type || "Unknown",
  }));

  const table = RewstDOM.createTable(data, {
    title: '<span class="material-icons text-rewst-teal">history</span> Recent Executions',
    columns: ["execution_id", "timestamp", "status", "organization", "tasks_used", "runtime", "trigger_type"],
    headers: {
      execution_id: "Execution",
      timestamp: "Date",
      status: "Status",
      organization: "Organization",
      tasks_used: "Tasks Used",
      runtime: "Runtime",
      trigger_type: "Trigger Type"
    },
    searchable: true,
    filters: {
      timestamp: {
        type: 'dateRange'
      },
      status: { label: "Status" },
      organization: { label: "Organization" },
      trigger_type: { label: "Trigger Type" }
    },
    transforms: {
      execution_id: (value, row) =>
        `<a href="${row.execution_link}" target="_blank" class="flex items-center gap-2 text-rewst-teal hover:text-rewst-light-teal"><span class="material-icons" style="font-size:16px;">open_in_new</span><span>View execution</span></a>`,
      timestamp: (value) => {
        const date = new Date(value);
        const dateStr = date.toLocaleDateString('en-US', {
          month: '2-digit',
          day: '2-digit',
          year: '2-digit'
        });
        const timeStr = date.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
        return `${dateStr} ${timeStr}`;
      },
      runtime: (value) => {
        if (value === null || value === undefined) return 'N/A';
        const numValue = parseFloat(value);
        if (isNaN(numValue)) return 'N/A';
        return numValue.toFixed(1) + 's';
      },
      tasks_used: (value) => {
        return value ? value.toLocaleString() : '0';
      },
      status: (value) => {
        if (["succeeded", "SUCCEEDED", "COMPLETED", "SUCCESS"].includes(value))
          return '<span class="badge badge-success">SUCCEEDED</span>';
        if (["FAILED", "failed"].includes(value))
          return '<span class="badge badge-error">FAILED</span>';
        if (["RUNNING", "running"].includes(value))
          return '<span class="badge badge-warning">RUNNING</span>';
        if (["CANCELED", "canceled", "CANCELLED", "cancelled"].includes(value))
          return '<span class="badge badge-warning">CANCELED</span>';
        return `<span class="badge">${value}</span>`;
      },
    },
    defaultSort: {
      column: 'timestamp',
      direction: 'desc'
    }
  });

  RewstDOM.place(table, "#workflow-executions");
}