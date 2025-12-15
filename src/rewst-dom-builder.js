/**
 * Rewst DOM Helpers
 * @fileoverview Simple utilities for creating and manipulating DOM elements
 * @author Nick Zipse <nick.zipse@rewst.com>
 * @version 4.2.0
 * 
 * NEW in v2: Form fields now respect conditional visibility rules from RewstApp v61+
 * 
 * REQUIREMENTS:
 * - Tailwind CSS (via CDN or local)
 * - Rewst Theme CSS (rewst-theme-css.css) - MUST be loaded AFTER Tailwind
 * - Material Icons (for icons)
 * - RewstApp library v61+ (for form creation with conditions)
 * 
 * STYLING:
 * This library uses Rewst's official CSS theme for all UI elements:
 * - Buttons use .btn-primary, .btn-secondary, .btn-tertiary classes
 * - Alerts use .alert-success, .alert-error, .alert-info, .alert-warning
 * - Colors use --rewst-teal, --rewst-fandango, --rewst-success, etc.
 * - Forms automatically styled by Rewst theme CSS
 */

const RewstDOM = {

  /**
   * Internal logging - only outputs when window.DEBUG_MODE is true
   */
  _log(...args) {
    if (window.DEBUG_MODE) {
      console.log('[RewstDOM]', ...args);
    }
  },

  /**
   * Create a table from an array of objects
   * @param {Array} data - Array of objects to display
   * @param {Object} options - Configuration options
   * @param {Array} options.columns - Which columns to show (defaults to all keys)
   * @param {Object} options.headers - Custom header names { key: 'Display Name' }
   * @param {Object} options.transforms - Transform functions for columns { key: (value, row) => transformedValue }
   * @param {String} options.className - Additional CSS classes for table
   * @param {Boolean} options.sortable - Enable column sorting (default: true)
   * @param {Boolean} options.searchable - Enable search filter (default: true)
   * @param {Object} options.rewstApp - RewstApp instance (defaults to window.rewstApp or window.rewst)
   * @param {String} options.workflowId - Workflow ID for refresh functionality
   * @param {String} options.dataPath - Path to data array in workflow result (e.g., 'output.company_time')
   * @param {Boolean} options.refreshable - Enable refresh button (default: true if workflowId provided)
   * @param {Object} options.defaultSort - Default sort configuration { column: 'columnName', direction: 'asc'|'desc' }
   * @param {Object} options.filters - Column filters { columnName: { label: 'Display Name', type: 'dateRange', dateFormat: 'unix' } }
   * @param {Boolean|Number} options.pagination - Enable pagination with rows per page (default: 10, false to disable)
   * @param {Array} options.paginationOptions - Available page size options (default: [10, 25, 50])
   * @param {String} options.title - Optional table title (supports HTML and emojis)
   * @returns {HTMLElement} Container with table and optional search
   */
  createTable(data, options = {}) {
    if (!Array.isArray(data) || data.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No data available';
      empty.className = 'text-gray-500 italic';
      return empty;
    }

    // Determine which columns to show
    const firstItem = data[0];
    const columns = options.columns || Object.keys(firstItem);
    const headers = options.headers || {};
    const transforms = options.transforms || {};
    const sortable = options.sortable !== false; // Default true
    const searchable = options.searchable !== false; // Default true
    const dataPath = options.dataPath || null;
    const defaultSort = options.defaultSort || null;
    const filters = options.filters || {};
    const workflowId = options.workflowId || null;
    const title = options.title || null;
    
    // Pagination settings
    const paginationEnabled = options.pagination !== false; // Default true
    const defaultPageSize = typeof options.pagination === 'number' ? options.pagination : 10;
    const paginationOptions = options.paginationOptions || [10, 25, 50];
    
    // Refreshable defaults to true if workflowId is provided, but can be overridden
    const refreshable = options.refreshable !== undefined ? options.refreshable : !!workflowId;
    
    // Get RewstApp instance
    const rewstApp = options.rewstApp || (typeof window !== 'undefined' ? (window.rewstApp || window.rewst) : null);
    
    // Determine if we can enable refresh (needs workflowId, rewstApp, and refreshable=true)
    const canRefresh = refreshable && workflowId && rewstApp;

    // Create container - full width
    const container = document.createElement('div');
    container.className = 'rewst-table-container w-full bg-white rounded-lg shadow-sm border border-gray-100 p-6';

    // Store original data and current display data
    let displayData = [...data];
    let sortColumn = defaultSort ? defaultSort.column : null;
    let sortDirection = defaultSort ? defaultSort.direction : 'desc'; // Default to desc for first click
    
    // Pagination state
    let currentPage = 1;
    let pageSize = defaultPageSize;
    let paginatedData = [];
    
    // Track active filters { columnName: Set of selected values }
    const activeFilters = {};
    
    // Initialize filter values for each filterable column
    const filterOptions = {};
    const dateRangeFilters = {}; // Track date range filter state
    
    Object.keys(filters).forEach(col => {
      const filterConfig = filters[col];
      
      if (filterConfig.type === 'dateRange') {
        // Date range filter - store min/max from data
        const dateFormat = filterConfig.dateFormat || 'unix';
        const timestamps = data
          .map(row => row[col])
          .filter(v => v !== null && v !== undefined)
          .map(v => {
            const parsed = RewstDOM._parseDate(v, dateFormat);
            return parsed ? parsed.getTime() : null;
          })
          .filter(v => v !== null);
        
        if (timestamps.length > 0) {
          const minDate = new Date(Math.min(...timestamps));
          const maxDate = new Date(Math.max(...timestamps));
          
          dateRangeFilters[col] = {
            minDate,
            maxDate,
            startDate: minDate,
            endDate: maxDate,
            format: dateFormat
          };
        }
      } else {
        // Regular dropdown filter
        const uniqueValues = [...new Set(data.map(row => row[col]))].filter(v => v !== null && v !== undefined);
        filterOptions[col] = uniqueValues.sort();
        activeFilters[col] = new Set(); // Empty = show all
      }
    });

    // Determine layout based on what controls exist
    const hasFiltersOrRefresh = canRefresh || Object.keys(filters).length > 0;
    const hasSearchOnly = searchable && !hasFiltersOrRefresh;
    
    // Add title if provided
    if (title) {
      const titleEl = document.createElement('h3');
      titleEl.className = 'text-lg font-semibold text-rewst-black';
      titleEl.innerHTML = title; // Use innerHTML to support HTML/emojis/icons
      
      if (hasSearchOnly) {
        // Title on same row as search
        const titleRow = document.createElement('div');
        titleRow.className = 'mb-4 flex justify-between items-center';
        titleRow.appendChild(titleEl);
        container.appendChild(titleRow);
      } else if (hasFiltersOrRefresh) {
        // Title above filters/refresh
        titleEl.className += ' mb-3';
        container.appendChild(titleEl);
      } else {
        // Title alone above table
        titleEl.className += ' mb-4';
        container.appendChild(titleEl);
      }
    }

    // Create top bar with refresh button (left) and search (right)
    if (canRefresh || Object.keys(filters).length > 0 || searchable) {
      const topBar = document.createElement('div');
      topBar.className = 'mb-4 flex justify-between items-center gap-3';
      
      // Left side: Refresh + Filters
      const leftSection = document.createElement('div');
      leftSection.className = 'flex items-center gap-2';
      
      // Refresh button on the left
      if (canRefresh) {
        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'material-icons bg-gray-50 text-rewst-teal hover:bg-gray-100 border border-gray-200 rounded-full p-2 transition-colors';
        refreshBtn.textContent = 'refresh';
        refreshBtn.title = 'Refresh table data';
        refreshBtn.onclick = async () => {
          refreshBtn.classList.add('animate-spin');
          refreshBtn.disabled = true;
          
          // Show loading state in table
          const loadingIndicator = document.createElement('div');
          loadingIndicator.className = 'flex items-center justify-center p-12';
          loadingIndicator.innerHTML = `
            <div class="text-center">
              <div class="spinner mx-auto mb-3"></div>
              <p class="text-rewst-gray">Refreshing data...</p>
            </div>
          `;
          
          // Replace table with loading indicator
          tableWrapper.innerHTML = '';
          tableWrapper.appendChild(loadingIndicator);
          
          try {
            // Run the workflow again to get fresh data
            const result = await rewstApp.runWorkflowSmart(workflowId, {});
            
            // Extract data from result based on dataPath
            let newData = result;
            if (dataPath) {
              const pathParts = dataPath.split('.');
              for (const part of pathParts) {
                newData = newData[part];
              }
            }
            
            // Update the data
            if (Array.isArray(newData)) {
              data = newData;
              
              // Re-detect filter options for both types
              Object.keys(filters).forEach(col => {
                const filterConfig = filters[col];
                
                if (filterConfig.type === 'dateRange') {
                  // Recalculate date range
                  const dateFormat = filterConfig.dateFormat || 'unix';
                  const timestamps = data
                    .map(row => row[col])
                    .filter(v => v !== null && v !== undefined)
                    .map(v => {
                      const parsed = RewstDOM._parseDate(v, dateFormat);
                      return parsed ? parsed.getTime() : null;
                    })
                    .filter(v => v !== null);
                  
                  if (timestamps.length > 0) {
                    const minDate = new Date(Math.min(...timestamps));
                    const maxDate = new Date(Math.max(...timestamps));
                    
                    dateRangeFilters[col] = {
                      minDate,
                      maxDate,
                      startDate: minDate,
                      endDate: maxDate,
                      format: dateFormat
                    };
                  }
                } else {
                  // Regular filter
                  const uniqueValues = [...new Set(data.map(row => row[col]))].filter(v => v !== null && v !== undefined);
                  filterOptions[col] = uniqueValues.sort();
                }
              });
              
              applyFiltersAndSearch();
              
              // Remove loading indicator and render new table
              tableWrapper.innerHTML = '';
              paginateData();
              renderTable();
              renderPagination();
              
              this.showSuccess('Table refreshed successfully!', 2000);
            } else {
              throw new Error('Refreshed data is not an array');
            }
          } catch (error) {
            console.error('Failed to refresh table:', error);
            
            // Remove loading indicator and show original table
            tableWrapper.innerHTML = '';
            renderTable();
            
            this.showError('Failed to refresh table data');
          } finally {
            refreshBtn.classList.remove('animate-spin');
            refreshBtn.disabled = false;
          }
        };
        leftSection.appendChild(refreshBtn);
      }
      
      // Filter chips
      Object.keys(filters).forEach(col => {
        const filterConfig = filters[col];
        
        // DATE RANGE FILTER
        if (filterConfig.type === 'dateRange') {
          const dateFilter = dateRangeFilters[col];
          if (!dateFilter) return; // Skip if no date data
          
          const dateFilterWrapper = document.createElement('div');
          dateFilterWrapper.className = 'flex items-center gap-2';
          
          // Label (optional)
          if (filterConfig.label) {
            const filterLabel = document.createElement('span');
            filterLabel.className = 'text-sm font-medium text-gray-700';
            filterLabel.textContent = filterConfig.label; // No colon added
            dateFilterWrapper.appendChild(filterLabel);
          }
          
          // Start date input
          const startDateInput = document.createElement('input');
          startDateInput.type = 'date';
          startDateInput.className = 'px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-rewst-teal';
          startDateInput.value = dateFilter.minDate.toISOString().split('T')[0];
          startDateInput.min = dateFilter.minDate.toISOString().split('T')[0];
          startDateInput.max = dateFilter.maxDate.toISOString().split('T')[0];
          
          // "to" label
          const toLabel = document.createElement('span');
          toLabel.className = 'text-sm text-gray-600';
          toLabel.textContent = 'to';
          
          // End date input
          const endDateInput = document.createElement('input');
          endDateInput.type = 'date';
          endDateInput.className = 'px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-rewst-teal';
          endDateInput.value = dateFilter.maxDate.toISOString().split('T')[0];
          endDateInput.min = dateFilter.minDate.toISOString().split('T')[0];
          endDateInput.max = dateFilter.maxDate.toISOString().split('T')[0];
          
          // Update filter when dates change
          const updateDateFilter = () => {
            const startDate = new Date(startDateInput.value);
            startDate.setHours(0, 0, 0, 0); // Start of day
            
            const endDate = new Date(endDateInput.value);
            endDate.setHours(23, 59, 59, 999); // End of day
            
            dateFilter.startDate = startDate;
            dateFilter.endDate = endDate;
            
            applyFiltersAndSearch();
            paginateData();
            renderTable();
            renderPagination();
          };
          
          startDateInput.addEventListener('change', updateDateFilter);
          endDateInput.addEventListener('change', updateDateFilter);
          
          dateFilterWrapper.appendChild(startDateInput);
          dateFilterWrapper.appendChild(toLabel);
          dateFilterWrapper.appendChild(endDateInput);
          leftSection.appendChild(dateFilterWrapper);
          
        } else {
          // REGULAR DROPDOWN FILTER (existing code)
          const filterChip = document.createElement('div');
          filterChip.className = 'relative';
          
          // Filter button/chip
          const filterBtn = document.createElement('button');
          filterBtn.className = 'flex items-center gap-1 px-3 py-1.5 text-sm font-medium border rounded-md transition-colors';
          
          // Update button appearance based on active state
          const updateFilterBtn = () => {
            const isActive = activeFilters[col].size > 0;
            if (isActive) {
              filterBtn.className = 'flex items-center gap-1 px-3 py-1.5 text-sm font-medium border-2 border-rewst-teal bg-rewst-light text-rewst-teal rounded-md transition-colors';
              filterBtn.innerHTML = `
                <span class="filter-label">${filterConfig.label}: ${activeFilters[col].size} selected</span>
                <span class="material-icons text-sm filter-clear-icon">close</span>
              `;
            } else {
              filterBtn.className = 'flex items-center gap-1 px-3 py-1.5 text-sm font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 rounded-md transition-colors';
              filterBtn.innerHTML = `
                <span class="filter-label">${filterConfig.label}</span>
                <span class="material-icons text-sm">expand_more</span>
              `;
            }
          };
          
          updateFilterBtn();
          
          // Dropdown menu
          const dropdown = document.createElement('div');
          dropdown.className = 'hidden absolute z-10 mt-1 bg-white border border-gray-200 rounded-md shadow-lg min-w-[200px] max-h-64 overflow-auto';
          dropdown.dataset.filterDropdown = col; // Mark as filter dropdown
          
          // Individual options
          filterOptions[col].forEach(value => {
            const optionLabel = document.createElement('label');
            optionLabel.className = 'flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'rounded border-gray-300';
            checkbox.checked = activeFilters[col].has(value);
            
            checkbox.addEventListener('change', (e) => {
              if (e.target.checked) {
                activeFilters[col].add(value);
              } else {
                activeFilters[col].delete(value);
              }
              
              updateFilterBtn();
              applyFiltersAndSearch();
              paginateData();
              renderTable();
              renderPagination();
            });
            
            const optionText = document.createElement('span');
            optionText.className = 'text-sm text-gray-700';
            optionText.textContent = String(value);
            
            optionLabel.appendChild(checkbox);
            optionLabel.appendChild(optionText);
            dropdown.appendChild(optionLabel);
          });
          
          // Toggle dropdown
          filterBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // Check if clicked on the clear icon (×) specifically
            const clickedElement = e.target;
            const isCloseIcon = clickedElement.classList.contains('filter-clear-icon') || 
                              clickedElement.textContent === 'close';
            
            if (isCloseIcon && activeFilters[col].size > 0) {
              // Clear this specific filter only when clicking the × icon
              activeFilters[col].clear();
              dropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                cb.checked = false;
              });
              updateFilterBtn();
              applyFiltersAndSearch();
              paginateData();
              renderTable();
              renderPagination();
              dropdown.classList.add('hidden'); // Close dropdown after clearing
              return;
            }
            
            // Otherwise, just toggle dropdown open/close (don't clear)
            const isHidden = dropdown.classList.contains('hidden');
            
            // Close all other dropdowns first
            document.querySelectorAll('[data-filter-dropdown]').forEach(d => {
              if (d !== dropdown) d.classList.add('hidden');
            });
            
            // Toggle this dropdown
            if (isHidden) {
              dropdown.classList.remove('hidden');
            } else {
              dropdown.classList.add('hidden');
            }
          });
          
          filterChip.appendChild(filterBtn);
          filterChip.appendChild(dropdown);
          leftSection.appendChild(filterChip);
        }
      });
      
      // Clear All button (only show if filters exist)
      if (Object.keys(filters).length > 0) {
        const clearAllBtn = document.createElement('button');
        clearAllBtn.className = 'text-sm text-rewst-teal hover:text-rewst-teal-dark font-medium';
        clearAllBtn.textContent = 'Clear All';
        clearAllBtn.onclick = () => {
          // Clear all dropdown filters
          Object.keys(activeFilters).forEach(col => {
            activeFilters[col].clear();
          });
          
          // Reset all date range filters to full range
          Object.keys(dateRangeFilters).forEach(col => {
            const dateFilter = dateRangeFilters[col];
            dateFilter.startDate = dateFilter.minDate;
            dateFilter.endDate = dateFilter.maxDate;
            
            // Update the date inputs
            const dateInputs = leftSection.querySelectorAll('input[type="date"]');
            dateInputs.forEach(input => {
              if (input.value) {
                // Find matching filter by checking nearby label
                const wrapper = input.closest('div');
                if (wrapper) {
                  const inputs = wrapper.querySelectorAll('input[type="date"]');
                  if (inputs[0] === input) {
                    // Start date
                    input.value = dateFilter.minDate.toISOString().split('T')[0];
                  } else if (inputs[1] === input) {
                    // End date
                    input.value = dateFilter.maxDate.toISOString().split('T')[0];
                  }
                }
              }
            });
          });
          
          // Update all filter buttons by rebuilding them
          Object.keys(filters).forEach(col => {
            const filterConfig = filters[col];
            if (filterConfig.type !== 'dateRange') {
              const filterBtns = leftSection.querySelectorAll('button');
              
              // Find the button for this specific filter
              filterBtns.forEach(btn => {
                const btnText = btn.querySelector('.filter-label');
                if (btnText && btnText.textContent.startsWith(filterConfig.label)) {
                  btn.className = 'flex items-center gap-1 px-3 py-1.5 text-sm font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 rounded-md transition-colors';
                  btn.innerHTML = `
                    <span class="filter-label">${filterConfig.label}</span>
                    <span class="material-icons text-sm">expand_more</span>
                  `;
                }
              });
            }
          });
          
          // Uncheck all checkboxes in all dropdowns
          container.querySelectorAll('[data-filter-dropdown] input[type="checkbox"]').forEach(cb => {
            cb.checked = false;
          });
          
          applyFiltersAndSearch();
          paginateData();
          renderTable();
          renderPagination();
        };
        leftSection.appendChild(clearAllBtn);
      }
      
      topBar.appendChild(leftSection);
      
      // Right side: Search
      if (searchable) {
        const searchContainer = document.createElement('div');
        searchContainer.className = 'relative w-64';

        // Search icon (Material Icons)
        const searchIcon = document.createElement('span');
        searchIcon.className = 'material-icons absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none';
        searchIcon.style.fontSize = '20px';
        searchIcon.textContent = 'search';

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search...';
        searchInput.className = 'w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500';
        
        searchInput.addEventListener('input', (e) => {
          applyFiltersAndSearch(e.target.value);
          paginateData();
          renderTable();
          renderPagination();
        });

        searchContainer.appendChild(searchIcon);
        searchContainer.appendChild(searchInput);
        
        // If title exists and this is search-only layout, add search to title row
        if (title && hasSearchOnly) {
          const titleRow = container.querySelector('.mb-4.flex');
          if (titleRow) {
            titleRow.appendChild(searchContainer);
          }
        } else {
          topBar.appendChild(searchContainer);
        }
      }
      
      // Only append topBar if it has children (filters/refresh exist)
      if (topBar.children.length > 0 && !hasSearchOnly) {
        container.appendChild(topBar);
      }
    }
    
    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
      // Check if click is outside any filter dropdown or button
      const clickedInsideFilter = e.target.closest('.rewst-table-container [data-filter-dropdown]') || 
                                  e.target.closest('.rewst-table-container button');
      
      if (!clickedInsideFilter) {
        // Close all filter dropdowns
        container.querySelectorAll('[data-filter-dropdown]').forEach(d => {
          d.classList.add('hidden');
        });
      }
    });
    
    // Function to apply filters and search
    const applyFiltersAndSearch = (searchTerm = '') => {
      displayData = data.filter(row => {
        // Apply dropdown filters
        for (const col in activeFilters) {
          if (activeFilters[col].size > 0) {
            // Include mode: only show if value is in the selected set
            if (!activeFilters[col].has(row[col])) {
              return false;
            }
          }
        }
        
        // Apply date range filters
        for (const col in dateRangeFilters) {
          const dateFilter = dateRangeFilters[col];
          const cellValue = row[col];
          
          if (cellValue !== null && cellValue !== undefined) {
            const cellDate = RewstDOM._parseDate(cellValue, dateFilter.format);
            
            if (cellDate) {
              const cellTime = cellDate.getTime();
              const startTime = dateFilter.startDate.getTime();
              const endTime = dateFilter.endDate.getTime();
              
              // Check if date is within range
              if (cellTime < startTime || cellTime > endTime) {
                return false;
              }
            }
          }
        }
        
        // Apply search
        if (searchTerm) {
          const lowerSearch = searchTerm.toLowerCase();
          return columns.some(col => {
            const value = row[col];
            if (value === null || value === undefined) return false;
            return String(value).toLowerCase().includes(lowerSearch);
          });
        }
        
        return true;
      });
      
      // Reset to first page when data changes
      currentPage = 1;
    };
    
    // Function to paginate data
    const paginateData = () => {
      if (!paginationEnabled || displayData.length <= pageSize) {
        paginatedData = displayData;
        return;
      }
      
      const startIdx = (currentPage - 1) * pageSize;
      const endIdx = startIdx + pageSize;
      paginatedData = displayData.slice(startIdx, endIdx);
    };

    // Create table wrapper for overflow - full width
    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'overflow-x-auto w-full';
    container.appendChild(tableWrapper);
    
    // Create pagination controls container
    const paginationWrapper = document.createElement('div');
    paginationWrapper.className = 'mt-4 flex justify-between items-center';
    container.appendChild(paginationWrapper);
    
    // Apply initial filters and search, then apply default sort if specified
    applyFiltersAndSearch();
    
    // Apply default sort if specified
    if (defaultSort && defaultSort.column) {
      displayData.sort((a, b) => {
        let aVal = a[defaultSort.column];
        let bVal = b[defaultSort.column];

        // Handle null/undefined
        if (aVal === null || aVal === undefined) aVal = '';
        if (bVal === null || bVal === undefined) bVal = '';

        // Handle numbers - use raw values which are always source of truth
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return defaultSort.direction === 'asc' ? aVal - bVal : bVal - aVal;
        }
        
        // Try to parse as numbers if they look numeric
        const aNum = parseFloat(aVal);
        const bNum = parseFloat(bVal);
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return defaultSort.direction === 'asc' ? aNum - bNum : bNum - aNum;
        }

        // Handle strings
        const aStr = String(aVal).toLowerCase();
        const bStr = String(bVal).toLowerCase();

        if (defaultSort.direction === 'asc') {
          return aStr.localeCompare(bStr);
        } else {
          return bStr.localeCompare(aStr);
        }
      });
    }
    
    // Initial pagination
    paginateData();

    // Function to render/re-render the table
    function renderTable() {
      // Clear existing table
      const existingTable = tableWrapper.querySelector('table');
      if (existingTable) {
        existingTable.remove();
      }

      // Create table - full width
      const table = document.createElement('table');
      table.className = options.className || 'min-w-full w-full divide-y divide-gray-200';

      // Create thead
      const thead = document.createElement('thead');
      thead.className = 'bg-rewst-light';
      const headerRow = document.createElement('tr');

      columns.forEach(col => {
        const th = document.createElement('th');
        th.className = 'px-6 py-3 text-left text-xs font-medium text-rewst-dark-gray uppercase tracking-wider';
        
        if (sortable) {
          th.className += ' cursor-pointer hover:bg-gray-100 select-none';
          th.style.position = 'relative';
          th.style.paddingRight = '2rem';
        }

        const headerText = document.createElement('span');
        headerText.textContent = headers[col] || col.replace(/_/g, ' ');
        th.appendChild(headerText);

        // Add sort indicator
        if (sortable) {
          const sortIndicator = document.createElement('span');
          sortIndicator.className = 'absolute right-2 top-3';
          
          if (sortColumn === col) {
            sortIndicator.textContent = sortDirection === 'asc' ? '↑' : '↓';
            sortIndicator.className += ' text-rewst-teal font-bold';
          } else {
            sortIndicator.textContent = '↕';
            sortIndicator.className += ' text-rewst-gray';
          }
          
          th.appendChild(sortIndicator);

          // Add click handler for sorting
          th.addEventListener('click', () => {
            if (sortColumn === col) {
              // Toggle direction
              sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
              sortColumn = col;
              sortDirection = 'desc'; // First click = descending (highest to lowest)
            }

            // Sort the data - always use raw values
            displayData.sort((a, b) => {
              let aVal = a[col];
              let bVal = b[col];

              // Handle null/undefined
              if (aVal === null || aVal === undefined) aVal = '';
              if (bVal === null || bVal === undefined) bVal = '';

              // Handle numbers - use raw values which are always source of truth
              if (typeof aVal === 'number' && typeof bVal === 'number') {
                return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
              }
              
              // Try to parse as numbers if they look numeric
              const aNum = parseFloat(aVal);
              const bNum = parseFloat(bVal);
              if (!isNaN(aNum) && !isNaN(bNum)) {
                return sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
              }

              // Handle strings
              const aStr = String(aVal).toLowerCase();
              const bStr = String(bVal).toLowerCase();

              if (sortDirection === 'asc') {
                return aStr.localeCompare(bStr);
              } else {
                return bStr.localeCompare(aStr);
              }
            });

            paginateData();
            renderTable();
            renderPagination();
          });
        }

        headerRow.appendChild(th);
      });

      thead.appendChild(headerRow);
      table.appendChild(thead);

      // Create tbody
      const tbody = document.createElement('tbody');
      tbody.className = 'bg-white divide-y divide-gray-200';

      if (paginatedData.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = columns.length;
        td.className = 'px-6 py-4 text-center text-gray-500 italic';
        td.textContent = 'No matching results';
        tr.appendChild(td);
        tbody.appendChild(tr);
      } else {
        paginatedData.forEach((row, idx) => {
          const tr = document.createElement('tr');
          tr.className = idx % 2 === 0 ? 'bg-white hover:bg-teal-50 border-b border-gray-100' : 'bg-gray-50 hover:bg-teal-50 border-b border-gray-100';

          columns.forEach(col => {
            const td = document.createElement('td');
            td.className = 'px-6 py-4 whitespace-nowrap text-sm text-gray-900';
            
            // ALWAYS store the raw value for sorting FIRST
            const rawValue = row[col];
            if (rawValue !== null && rawValue !== undefined) {
              td.dataset.sortValue = rawValue;
            }
            
            let value = rawValue;
            
            // Apply transform if defined (this changes display, but raw value already stored)
            if (transforms[col]) {
              try {
                value = transforms[col](value, row);
              } catch (error) {
                console.error(`Transform error for column ${col}:`, error);
              }
            }
            
            // Handle different data types
            if (value === null || value === undefined) {
              td.textContent = '-';
              td.className += ' text-gray-400';
            } else if (typeof value === 'object') {
              td.textContent = JSON.stringify(value);
              td.className = td.className.replace('whitespace-nowrap', 'whitespace-pre-wrap');
            } else {
              // Check if value contains HTML tags (for badges, etc.)
              if (typeof value === 'string' && value.includes('<')) {
                td.innerHTML = value; // Use innerHTML for HTML content
              } else {
                td.textContent = value; // Use textContent for plain text
              }
            }

            tr.appendChild(td);
          });

          tbody.appendChild(tr);
        });
      }

      table.appendChild(tbody);
      tableWrapper.appendChild(table);

      tbody.offsetHeight; // This forces the browser to process the DOM changes
    }
    
    // Function to render pagination controls
    function renderPagination() {
      paginationWrapper.innerHTML = '';
      
      // Only show pagination if enabled AND we have more rows than page size
      if (!paginationEnabled || displayData.length <= pageSize) {
        return;
      }
      
      const totalPages = Math.ceil(displayData.length / pageSize);
      
      // Left side: Showing X-Y of Z results
      const infoText = document.createElement('div');
      infoText.className = 'text-sm text-gray-600';
      const startIdx = (currentPage - 1) * pageSize + 1;
      const endIdx = Math.min(currentPage * pageSize, displayData.length);
      infoText.textContent = `Showing ${startIdx}-${endIdx} of ${displayData.length} results`;
      paginationWrapper.appendChild(infoText);
      
      // Center: Page navigation
      const navWrapper = document.createElement('div');
      navWrapper.className = 'flex items-center gap-1';
      
      // Previous button
      const prevBtn = document.createElement('button');
      prevBtn.className = 'px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors';
      prevBtn.innerHTML = '<span class="material-icons" style="font-size: 18px;">chevron_left</span>';
      prevBtn.disabled = currentPage === 1;
      prevBtn.onclick = () => {
        if (currentPage > 1) {
          currentPage--;
          paginateData();
          renderTable();
          renderPagination();
        }
      };
      navWrapper.appendChild(prevBtn);
      
      // Generate page numbers with sliding window
      const getPageNumbers = () => {
        const pages = [];
        const maxVisible = 5; // Show exactly 5 page numbers
        
        if (totalPages <= maxVisible) {
          // Show all pages if total is 5 or less
          for (let i = 1; i <= totalPages; i++) {
            pages.push(i);
          }
        } else {
          // Calculate sliding window of pages to show
          let startPage = Math.max(1, currentPage - 2);
          let endPage = Math.min(totalPages, startPage + maxVisible - 1);
          
          // Adjust if we're near the end
          if (endPage - startPage < maxVisible - 1) {
            startPage = Math.max(1, endPage - maxVisible + 1);
          }
          
          // Add visible page range (just the numbers, no ellipsis or bookends)
          for (let i = startPage; i <= endPage; i++) {
            pages.push(i);
          }
        }
        
        return pages;
      };
      
      // Render page buttons
      const pageNumbers = getPageNumbers();
      pageNumbers.forEach(page => {
        const pageBtn = document.createElement('button');
        const isActive = page === currentPage;
        
        if (isActive) {
          pageBtn.className = 'px-3 py-1 bg-rewst-teal text-white border border-rewst-teal rounded font-medium transition-colors';
        } else {
          pageBtn.className = 'px-3 py-1 border border-gray-300 text-gray-700 rounded hover:bg-gray-50 transition-colors';
        }
        
        pageBtn.textContent = page;
        pageBtn.onclick = () => {
          currentPage = page;
          paginateData();
          renderTable();
          renderPagination();
        };
        navWrapper.appendChild(pageBtn);
      });
      
      // Next button
      const nextBtn = document.createElement('button');
      nextBtn.className = 'px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors';
      nextBtn.innerHTML = '<span class="material-icons" style="font-size: 18px;">chevron_right</span>';
      nextBtn.disabled = currentPage === totalPages;
      nextBtn.onclick = () => {
        if (currentPage < totalPages) {
          currentPage++;
          paginateData();
          renderTable();
          renderPagination();
        }
      };
      navWrapper.appendChild(nextBtn);
      
      paginationWrapper.appendChild(navWrapper);
      
      // Right side: Page size selector
      const pageSizeWrapper = document.createElement('div');
      pageSizeWrapper.className = 'flex items-center gap-2';
      
      const pageSizeLabel = document.createElement('span');
      pageSizeLabel.className = 'text-sm text-gray-600';
      pageSizeLabel.textContent = 'Rows:';
      
      const pageSizeSelect = document.createElement('select');
      pageSizeSelect.className = 'px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:border-gray-400';
      
      paginationOptions.forEach(option => {
        const opt = document.createElement('option');
        opt.value = option;
        opt.textContent = option;
        if (option === pageSize) opt.selected = true;
        pageSizeSelect.appendChild(opt);
      });
      
      pageSizeSelect.addEventListener('change', (e) => {
        pageSize = parseInt(e.target.value);
        currentPage = 1; // Reset to first page
        paginateData();
        renderTable();
        renderPagination();
      });
      
      pageSizeWrapper.appendChild(pageSizeLabel);
      pageSizeWrapper.appendChild(pageSizeSelect);
      paginationWrapper.appendChild(pageSizeWrapper);
    }

    // Initial render
    renderTable();
    renderPagination();

    return container;
  },


  /**
   * Parse date from various formats to Date object
   * @private
   */
  _parseDate(value, format = 'unix') {
    if (!value) return null;

    switch (format) {
      case 'unix':
        const timestamp = parseInt(value);
        return new Date(timestamp < 10000000000 ? timestamp * 1000 : timestamp);
      case 'iso':
        return new Date(value);
      default:
        return new Date(value);
    }
  },

  /**
   * Place content inside an element (clears existing content)
   * @param {HTMLElement} element - Element to insert (what to place)
   * @param {String|HTMLElement} target - Selector or element (where to place it)
   */
  place(element, target) {
    const targetElement = typeof target === 'string'
      ? document.querySelector(target)
      : target;

    if (!targetElement) {
      console.error('Target element not found:', target);
      return;
    }

    // Clear the element and add new content
    targetElement.innerHTML = '';
    targetElement.appendChild(element);
  },

  /**
   * Show loading state in an element
   * @param {String|HTMLElement} target - Selector or element
   * @param {String} message - Loading message (default: "Loading...")
   */
  showLoading(target, message = 'Loading...') {
    const element = typeof target === 'string'
      ? document.querySelector(target)
      : target;

    if (!element) {
      console.error('Target element not found:', target);
      return;
    }

    element.innerHTML = `
        <div class="flex items-center justify-center p-8">
          <div class="text-center">
            <div class="spinner mx-auto mb-2"></div>
            <p class="text-rewst-gray">${message}</p>
          </div>
        </div>
      `;
  },

  /**
   * Show skeleton loader for a metric card
   * @param {String|HTMLElement} target - Selector or element
   */
  showMetricSkeleton(target) {
    const element = typeof target === 'string'
      ? document.querySelector(target)
      : target;

    if (!element) {
      console.error('Target element not found:', target);
      return;
    }

    element.innerHTML = `
        <div class="card card-metric animate-pulse">
          <div class="flex items-start justify-between mb-4">
            <div class="flex-1">
              <div class="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
              <div class="h-3 bg-gray-200 rounded w-1/3"></div>
            </div>
            <div class="bg-gray-200 rounded-full w-12 h-12"></div>
          </div>
          <div class="h-10 bg-gray-200 rounded w-3/4 mb-2"></div>
          <div class="h-3 bg-gray-200 rounded w-1/3"></div>
        </div>
      `;
  },

  /**
   * Show skeleton loader for a chart
   * @param {String|HTMLElement} target - Selector or element
   * @param {String} height - Chart height (default: '400px')
   */
  showChartSkeleton(target, height = '400px') {
    const element = typeof target === 'string'
      ? document.querySelector(target)
      : target;

    if (!element) {
      console.error('Target element not found:', target);
      return;
    }

    element.innerHTML = `
        <div class="w-full bg-white rounded-lg shadow-sm border border-gray-100 p-6 animate-pulse">
          <div class="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div class="bg-gray-200 rounded" style="height: ${height}"></div>
        </div>
      `;
  },

  /**
   * Show skeleton loader for a table
   * @param {String|HTMLElement} target - Selector or element
   * @param {Number} rows - Number of skeleton rows to show (default: 5)
   */
  showTableSkeleton(target, rows = 5) {
    const element = typeof target === 'string'
      ? document.querySelector(target)
      : target;

    if (!element) {
      console.error('Target element not found:', target);
      return;
    }

    const rowsHTML = Array(rows).fill(0).map(() => `
        <div class="flex gap-4 py-3 border-b border-gray-100">
          <div class="h-4 bg-gray-200 rounded flex-1"></div>
          <div class="h-4 bg-gray-200 rounded flex-1"></div>
          <div class="h-4 bg-gray-200 rounded flex-1"></div>
        </div>
      `).join('');

    element.innerHTML = `
        <div class="w-full bg-white rounded-lg shadow-sm border border-gray-100 p-6 animate-pulse">
          <div class="h-6 bg-gray-200 rounded w-1/4 mb-4"></div>
          ${rowsHTML}
        </div>
      `;
  },

  /**
   * Show skeleton loader for a form
   * @param {String|HTMLElement} target - Selector or element
   * @param {Number} fields - Number of skeleton fields to show (default: 4)
   */
  showFormSkeleton(target, fields = 4) {
    const element = typeof target === 'string'
      ? document.querySelector(target)
      : target;

    if (!element) {
      console.error('Target element not found:', target);
      return;
    }

    const fieldsHTML = Array(fields).fill(0).map(() => `
        <div class="mb-6">
          <div class="h-4 bg-gray-200 rounded w-1/4 mb-2"></div>
          <div class="h-10 bg-gray-200 rounded w-full"></div>
        </div>
      `).join('');

    element.innerHTML = `
        <div class="w-full bg-white rounded-lg shadow-sm border border-gray-100 p-6 animate-pulse">
          <div class="h-8 bg-gray-200 rounded w-1/2 mb-6"></div>
          ${fieldsHTML}
          <div class="h-10 bg-gray-200 rounded w-32 mt-4"></div>
        </div>
      `;
  },

  /**
   * Show skeleton loader for a button
   * @param {String|HTMLElement} target - Selector or element
   * @param {Number} width - Width in pixels (default: 130)
   * @param {Number} height - Height in pixels (default: 52)
   */
  showButtonSkeleton(target, width = 130, height = 52) {
    const element = typeof target === 'string'
      ? document.querySelector(target)
      : target;

    if (!element) {
      console.error('Target element not found:', target);
      return;
    }

    element.innerHTML = `
      <div class="bg-gray-200 rounded-lg animate-pulse" style="width: ${width}px; height: ${height}px;"></div>
    `;
  },

  /**
   * Load and place a table on the page
   * @param {Array} data - Array of objects to display
   * @param {String|HTMLElement} target - Selector or element to place table in
   * @param {Object} options - Table configuration options (see createTable)
   * @returns {HTMLElement} The created table container
   */
  loadTable(data, target, options = {}) {
    // Show skeleton while creating table
    this.showTableSkeleton(target);

    // Small delay to show skeleton, then create and place actual table
    setTimeout(() => {
      const table = this.createTable(data, options);
      const element = typeof target === 'string' ? document.querySelector(target) : target;
      if (element) {
        element.innerHTML = '';
        element.appendChild(table);
      }
    }, 100);

    return target;
  },

  /**
   * Create a table from workflow execution data
   * @param {String} workflowId - Workflow ID to use for data refresh
   * @param {Array} data - Initial array of objects to display
   * @param {String} dataPath - Path to data array in workflow result (e.g., 'output.metrics')
   * @param {Object} options - Table configuration options (see createTable)
   * @returns {HTMLElement} Container with table (with refresh enabled)
   */
  createWorkflowTable(workflowId, data, dataPath, options = {}) {
    return this.createTable(data, {
      ...options,
      workflowId,
      dataPath
    });
  },

  /**
   * Load workflow execution data and create a table
   * @param {String} workflowId - Workflow ID to fetch execution from
   * @param {String|HTMLElement} target - Selector or element to place table in
   * @param {String} dataPath - Path to data array in result (e.g., 'output.metrics')
   * @param {Object} options - Table configuration options
   * @returns {Promise<HTMLElement>} The created table container
   */
  async loadWorkflowTable(workflowId, target, dataPath, options = {}) {
    // Get RewstApp instance
    const rewstApp = options.rewstApp || (typeof window !== 'undefined' ? (window.rewstApp || window.rewst) : null);

    if (!rewstApp) {
      throw new Error('RewstApp instance not found. Please ensure RewstApp is loaded.');
    }

    // Show skeleton loader
    this.showTableSkeleton(target);

    try {
      // Get the most recent execution
      const result = await rewstApp.getLastWorkflowExecution(workflowId);

      // Extract data from the specified path
      let data = result;
      if (dataPath) {
        const pathParts = dataPath.split('.');
        for (const part of pathParts) {
          data = data[part];
          if (data === undefined || data === null) {
            throw new Error(`Data path '${dataPath}' not found in workflow result`);
          }
        }
      }

      if (!Array.isArray(data)) {
        throw new Error('Extracted data is not an array');
      }

      // Create workflow table (with refresh enabled)
      const table = this.createWorkflowTable(workflowId, data, dataPath, options);

      // Place on page
      this.place(table, target);

      return table;
    } catch (error) {
      console.error('Failed to load workflow table:', error);

      // Show error in target
      const targetEl = typeof target === 'string' ? document.querySelector(target) : target;
      if (targetEl) {
        targetEl.innerHTML = `
            <div class="text-center p-8 text-red-600">
              <p class="font-medium mb-2">Failed to load workflow data</p>
              <p class="text-sm text-gray-600">${error.message}</p>
            </div>
          `;
      }

      throw error;
    }
  },

  /**
   * Load and place a form on the page
   * @param {String} formId - Form ID
   * @param {String|HTMLElement} target - Selector or element to place form in
   * @param {Object} options - Form configuration options (see createForm)
   * @returns {Promise<HTMLFormElement>} The created form element
   */
  async loadForm(formId, target, options = {}) {
    // Show skeleton loader
    this.showFormSkeleton(target);

    try {
      const form = await this.createForm(formId, options);
      this.place(form, target);
      return form;
    } catch (error) {
      console.error('Failed to load form:', error);

      // Show error in target
      const targetEl = typeof target === 'string' ? document.querySelector(target) : target;
      if (targetEl) {
        targetEl.innerHTML = `
            <div class="text-center p-8 text-red-600">
              <p class="font-medium mb-2">Failed to load form</p>
              <p class="text-sm text-gray-600">${error.message}</p>
            </div>
          `;
      }

      throw error;
    }
  },

  /**
   * Load and place a chart on the page
   * @param {Array} data - Array of objects to chart
   * @param {String|HTMLElement} target - Selector or element to place chart in
   * @param {Object} options - Chart configuration options (see createChart)
   * @returns {HTMLElement} The created chart container
   */
  loadChart(data, target, options = {}) {
    // Show skeleton while creating chart
    const height = options.height || '400px';
    this.showChartSkeleton(target, height);

    // Small delay to show skeleton, then create and place actual chart
    setTimeout(() => {
      const chart = this.createChart(data, options);
      const element = typeof target === 'string' ? document.querySelector(target) : target;
      if (element) {
        element.innerHTML = '';
        element.appendChild(chart);
      }
    }, 100);

    return target;
  },

  /**
   * Load and place a metric card on the page
   * @param {String|HTMLElement} target - Selector or element to place card in
   * @param {Object} options - Metric card configuration options (see createMetricCard)
   * @returns {HTMLElement} The created metric card
   */
  loadMetricCard(target, options = {}) {
    // Show skeleton while creating card
    this.showMetricSkeleton(target);

    // Small delay to show skeleton, then create and place actual card
    setTimeout(() => {
      const card = this.createMetricCard(options);
      const element = typeof target === 'string' ? document.querySelector(target) : target;
      if (element) {
        element.innerHTML = '';
        element.appendChild(card);
      }
    }, 100);

    return target;
  },

  /**
   * Convert basic markdown to HTML
   * @private
   */
  _markdownToHtml(markdown) {
    return markdown
      // Headers
      .replace(/^### (.*$)/gim, '<h3 class="text-lg font-semibold mb-2">$1</h3>')
      .replace(/^## (.*$)/gim, '<h2 class="text-xl font-bold mb-3">$1</h2>')
      .replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mb-4">$1</h1>')
      // Bold
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Line breaks
      .replace(/\n/g, '<br>');
  },

  /**
 * Create a simple dropdown (select element)
 * @param {Array} options - Array of {value, label} objects
 * @param {Object} config - Configuration options
 * @returns {HTMLElement} The select element
 */
  createDropdown(options, config = {}) {
    const {
      placeholder = 'Select...',
      defaultValue = null,
      onChange = null,
      includeEmpty = false
    } = config;
  
    const wrapper = document.createElement('div');
    wrapper.className = 'relative w-full';
  
    const select = document.createElement('select');
    select.className = 'w-full px-3 py-2 pr-10 border-2 border-rewst-light-gray rounded-md focus:outline-none focus:ring-2 focus:ring-rewst-teal focus:border-rewst-teal bg-white text-sm text-rewst-dark-gray appearance-none cursor-pointer transition-colors hover:border-rewst-gray';
    select.style.backgroundImage = "url('data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'12\\' height=\\'12\\' viewBox=\\'0 0 12 12\\'%3E%3Cpath fill=\\'%23009490\\' d=\\'M6 9L1 4h10z\\'/%3E%3C/svg%3E')";
    select.style.backgroundRepeat = 'no-repeat';
    select.style.backgroundPosition = 'right 1rem center';
    select.style.backgroundSize = '12px';
  
    // Add empty/placeholder option if requested
    if (includeEmpty) {
      const emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = placeholder;
      select.appendChild(emptyOption);
    }
  
    // Add options
    options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (defaultValue !== null && opt.value === defaultValue) {
        option.selected = true;
      }
      select.appendChild(option);
    });
  
    // Add change listener
    if (onChange) {
      select.addEventListener('change', (e) => {
        const selectedOption = options.find(o => o.value === e.target.value);
        onChange(selectedOption || null, e.target.value);
      });
    }
  
    wrapper.appendChild(select);
    return wrapper;
  },

    /**
   * Create a custom styled single-select dropdown (looks like multiselect but single choice)
   * @param {Array} options - Array of {value, label} objects
   * @param {Object} config - Configuration options
   * @returns {HTMLElement} The dropdown component
   */
  createStyledDropdown(options, config = {}) {
    const {
      placeholder = 'Select...',
      defaultValue = null,
      onChange = null
    } = config;

    const wrapper = document.createElement('div');
    wrapper.className = 'w-full relative';

    let selectedValue = defaultValue;

    // Create display container (like tags container but shows single value)
    const displayContainer = document.createElement('div');
    displayContainer.className = 'w-full min-h-[42px] px-3 py-2 border-2 border-rewst-light-gray rounded-md focus-within:ring-2 focus-within:ring-rewst-teal focus-within:border-rewst-teal flex items-center justify-between bg-white cursor-pointer hover:border-rewst-gray transition-colors';

    // Create dropdown menu
    const dropdownMenu = document.createElement('div');
    dropdownMenu.className = 'hidden absolute z-10 w-full mt-1 bg-white border-2 border-rewst-light-gray rounded-md shadow-lg overflow-auto max-h-60';

    // Render selected value
    const renderDisplay = () => {
      const selectedOption = options.find(o => o.value === selectedValue);
      const label = selectedOption ? selectedOption.label : placeholder;
      
      displayContainer.innerHTML = `
        <span class="text-sm ${selectedOption ? 'text-rewst-dark-gray' : 'text-rewst-gray'}">${label}</span>
        <span class="material-icons text-rewst-gray" style="font-size: 20px;">expand_more</span>
      `;
    };

    // Render dropdown options
    const renderDropdown = () => {
      dropdownMenu.innerHTML = '';

      options.forEach(option => {
        const isSelected = option.value === selectedValue;

        const optionEl = document.createElement('button');
        optionEl.type = 'button';
        optionEl.className = `w-full px-3 py-2 text-left transition-colors flex items-center justify-between ${
          isSelected ? 'bg-rewst-light' : ''
        }`;

        optionEl.addEventListener('mouseenter', () => {
          optionEl.style.backgroundColor = 'var(--rewst-light-gray)';
          if (!isSelected) {
            labelSpan.style.color = 'var(--rewst-teal)';
          }
        });

        optionEl.addEventListener('mouseleave', () => {
          if (!isSelected) {
            optionEl.style.backgroundColor = '';
            labelSpan.style.color = '';
          } else {
            optionEl.style.backgroundColor = 'var(--rewst-light)';
          }
        });

        const labelSpan = document.createElement('span');
        labelSpan.textContent = option.label;
        labelSpan.className = isSelected ? 'text-rewst-teal font-medium text-sm' : 'text-rewst-dark-gray text-sm';

        const checkIcon = document.createElement('span');
        checkIcon.className = 'material-icons text-rewst-teal';
        checkIcon.style.fontSize = '20px';
        checkIcon.textContent = 'check';
        checkIcon.style.visibility = isSelected ? 'visible' : 'hidden';

        optionEl.appendChild(labelSpan);
        optionEl.appendChild(checkIcon);

        optionEl.onclick = (e) => {
          e.stopPropagation();
          selectedValue = option.value;
          renderDisplay();
          renderDropdown();
          dropdownMenu.classList.add('hidden');
          if (onChange) onChange(option, option.value);
        };

        dropdownMenu.appendChild(optionEl);
      });
    };

    // Toggle dropdown
    displayContainer.onclick = (e) => {
      e.stopPropagation();
      dropdownMenu.classList.toggle('hidden');
    };

    // Close on outside click
    const closeHandler = (e) => {
      if (!wrapper.contains(e.target)) {
        dropdownMenu.classList.add('hidden');
      }
    };
    document.addEventListener('click', closeHandler);

    wrapper.appendChild(displayContainer);
    wrapper.appendChild(dropdownMenu);

    // Initial render
    renderDisplay();
    renderDropdown();

    return wrapper;
  },

  /**
   * Create a standalone multiselect dropdown
   * @param {Array} options - Array of {value, label} objects
   * @param {Object} config - Configuration options
   * @returns {HTMLElement} The multiselect component
   */
  createMultiSelect(options, config = {}) {
    const {
      placeholder = 'Select items...',
      defaultValues = [],
      onChange = null,
      maxHeight = '240px'
    } = config;

    const wrapper = document.createElement('div');
    wrapper.className = 'w-full relative';

    // Store selected values
    const selectedValues = new Set(defaultValues);

    // Create tags container (acts as the clickable input)
    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'w-full min-h-[42px] px-3 py-2 border-2 border-rewst-light-gray rounded-md focus-within:ring-2 focus-within:ring-rewst-teal focus-within:border-rewst-teal flex flex-wrap gap-2 items-center bg-white cursor-pointer hover:border-rewst-gray transition-colors';

    // Create dropdown menu
    const dropdownMenu = document.createElement('div');
    dropdownMenu.className = 'hidden absolute z-10 w-full mt-1 bg-white border-2 border-rewst-light-gray rounded-md shadow-lg overflow-auto';
    dropdownMenu.style.maxHeight = maxHeight;

    // Render tags
    const renderTags = () => {
      tagsContainer.innerHTML = '';

      if (selectedValues.size > 0) {
        selectedValues.forEach(value => {
          const option = options.find(opt => opt.value === value);
          const label = option ? option.label : value;

          const tag = document.createElement('div');
          tag.className = 'inline-flex items-center gap-1 px-3 py-1.5 bg-rewst-light-gray text-rewst-dark-gray rounded-full text-sm font-medium';

          const tagLabel = document.createElement('span');
          tagLabel.textContent = label;

          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.className = 'material-icons text-rewst-dark-gray hover:text-rewst-black cursor-pointer';
          removeBtn.style.fontSize = '18px';
          removeBtn.textContent = 'close';
          removeBtn.onclick = (e) => {
            e.stopPropagation();
            selectedValues.delete(value);
            renderTags();
            renderDropdown();
            if (onChange) onChange(Array.from(selectedValues));
          };

          tag.appendChild(tagLabel);
          tag.appendChild(removeBtn);
          tagsContainer.appendChild(tag);
        });
      } else {
        const placeholderSpan = document.createElement('span');
        placeholderSpan.className = 'text-rewst-gray text-sm';
        placeholderSpan.textContent = placeholder;
        tagsContainer.appendChild(placeholderSpan);
      }

      // Add dropdown arrow
      const arrow = document.createElement('span');
      arrow.className = 'material-icons text-rewst-gray ml-auto';
      arrow.style.fontSize = '20px';
      arrow.textContent = 'expand_more';
      tagsContainer.appendChild(arrow);
    };

    // Render dropdown options
    const renderDropdown = () => {
      dropdownMenu.innerHTML = '';

      if (options.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'px-3 py-2 text-rewst-gray text-sm';
        emptyMsg.textContent = 'No options available';
        dropdownMenu.appendChild(emptyMsg);
        return;
      }

      options.forEach(option => {
        const isSelected = selectedValues.has(option.value);

        const optionEl = document.createElement('button');
        optionEl.type = 'button';
        optionEl.className = `w-full px-3 py-2 text-left transition-colors flex items-center justify-between ${
          isSelected ? 'bg-rewst-light' : ''
        }`;

        optionEl.addEventListener('mouseenter', () => {
          optionEl.style.backgroundColor = 'var(--rewst-light-gray)';
          if (!isSelected) {
            labelSpan.style.color = 'var(--rewst-teal)';
          }
        });

        optionEl.addEventListener('mouseleave', () => {
          if (!isSelected) {
            optionEl.style.backgroundColor = '';
            labelSpan.style.color = '';
          } else {
            optionEl.style.backgroundColor = 'var(--rewst-light)';
          }
        });

        const labelSpan = document.createElement('span');
        labelSpan.textContent = option.label;
        labelSpan.className = isSelected ? 'text-rewst-teal font-medium text-sm' : 'text-rewst-dark-gray text-sm';

        const checkIcon = document.createElement('span');
        checkIcon.className = 'material-icons text-rewst-teal';
        checkIcon.style.fontSize = '20px';
        checkIcon.textContent = 'check';
        checkIcon.style.visibility = isSelected ? 'visible' : 'hidden';

        optionEl.appendChild(labelSpan);
        optionEl.appendChild(checkIcon);

        optionEl.onclick = (e) => {
          e.stopPropagation(); // Prevent click from bubbling up
          if (isSelected) {
            selectedValues.delete(option.value);
          } else {
            selectedValues.add(option.value);
          }
          renderTags();
          renderDropdown();
          if (onChange) onChange(Array.from(selectedValues));
        };

        dropdownMenu.appendChild(optionEl);
      });
    };

    // Toggle dropdown
    tagsContainer.onclick = (e) => {
      if (e.target.closest('button[type="button"]')) return;
      e.stopPropagation(); // Prevent click from bubbling up
      dropdownMenu.classList.toggle('hidden');
    };

    // Close on outside click
    const closeHandler = (e) => {
      if (!wrapper.contains(e.target)) {
        dropdownMenu.classList.add('hidden');
      }
    };
    document.addEventListener('click', closeHandler);

    wrapper.appendChild(tagsContainer);
    wrapper.appendChild(dropdownMenu);

    // Initial render
    renderTags();
    renderDropdown();

    // Add method to get current values
    wrapper.getValues = () => Array.from(selectedValues);
    wrapper.setValues = (values) => {
      selectedValues.clear();
      values.forEach(v => selectedValues.add(v));
      renderTags();
      renderDropdown();
    };

    return wrapper;
  },


  /**
   * Create a Rewst form dynamically with conditional field support and workflow tracking
   * Requires RewstApp v61+ for condition evaluation
   * @param {String} formId - Form ID
   * @param {Object} options - Configuration options
   * @param {Object} options.rewstApp - RewstApp instance (optional, defaults to window.rewstApp or window.rewst)
   * @param {Function} options.onSubmit - Callback when form is submitted successfully (result, values). Note: The library automatically shows a success toast, so don't call showSuccess() in this callback.
   * @param {Function} options.onError - Callback when form submission fails
   * @param {Boolean} options.trackWorkflow - Enable workflow progress tracking (default: true)
   * @returns {Promise<HTMLFormElement>}
   */
  async createForm(formId, options = {}) {
    const { onSubmit, onError, trackWorkflow = true } = options;

    // Get RewstApp instance - try options first, then window global (check both rewstApp and rewst)
    const rewstApp = options.rewstApp || (typeof window !== 'undefined' ? (window.rewstApp || window.rewst) : null);

    if (!rewstApp) {
      throw new Error('RewstApp instance not found. Please ensure RewstApp is loaded or pass it via options.rewstApp');
    }

    // Fetch form details
    const formData = await rewstApp._getForm(formId);

    if (!formData) {
      throw new Error(`Form ${formId} not found`);
    }

    // Sort fields by index
    const sortedFields = [...formData.fields].sort((a, b) => {
      const indexA = a.index !== undefined ? a.index : 999;
      const indexB = b.index !== undefined ? b.index : 999;
      return indexA - indexB;
    });

    // Create form element
    const form = document.createElement('form');
    form.className = 'w-full bg-white rounded-lg shadow-sm border border-gray-100 p-6';

    // Add title if form has a name
    if (formData.name) {
      const title = document.createElement('h2');
      title.className = 'text-2xl font-bold text-gray-900 mb-6 pb-4 border-b-2 border-gray-200';
      title.textContent = formData.name;
      form.appendChild(title);
    }

    // Add description if exists
    if (formData.description) {
      const desc = document.createElement('p');
      desc.className = 'text-gray-600 mb-6';
      desc.textContent = formData.description;
      form.appendChild(desc);
    }

    // Store for dynamic field options
    const dynamicFieldsData = {};

    // Store multiselect clear functions
    const multiselectClearFunctions = [];

    // Initialize form values with defaults
    const formValues = {};
    sortedFields.forEach(field => {
      if (field.schema?.name) {
        const schema = field.schema;
        let defaultValue = schema.default;

        // Set type-appropriate defaults
        if (defaultValue === undefined || defaultValue === null) {
          switch (field.type) {
            case 'CHECKBOX':
              defaultValue = false;
              break;
            case 'MULTISELECT':
              defaultValue = [];
              break;
            case 'NUMBER_INPUT':
              defaultValue = schema.min || 0;
              break;
            default:
              defaultValue = null;
          }
        }

        // Convert string defaults to proper types
        if (field.type === 'NUMBER_INPUT' && typeof defaultValue === 'string') {
          defaultValue = parseFloat(defaultValue);
        } else if (field.type === 'CHECKBOX' && typeof defaultValue === 'string') {
          defaultValue = defaultValue === 'true';
        }

        formValues[schema.name] = defaultValue;
      }
    });

    // Map to store field wrappers for show/hide
    const fieldWrappers = new Map();

    // Function to update field visibility based on current form values
    const updateFieldVisibility = () => {
      sortedFields.forEach(field => {
        if (!field.schema?.name) return;

        const wrapper = fieldWrappers.get(field.id);
        if (!wrapper) return;

        const evaluation = rewstApp.evaluateFieldConditions(field, formValues);

        // Show or hide the field
        if (evaluation.visible) {
          wrapper.style.display = '';
          wrapper.classList.remove('hidden');
        } else {
          wrapper.style.display = 'none';
          wrapper.classList.add('hidden');
        }

        // Update required status - CRITICAL: Remove required from hidden fields
        const input = wrapper.querySelector(`[name="${field.id}"]`);
        if (input && field.type !== 'TEXT') {
          if (evaluation.visible) {
            input.required = evaluation.required;
          } else {
            // Remove required from hidden fields to prevent validation errors
            input.required = false;
          }
        }
      });
    };

    // Create fields
    for (const field of sortedFields) {
      const fieldWrapper = document.createElement('div');
      fieldWrapper.className = 'mb-8 w-full';

      const schema = field.schema || {};
      const label = schema.label || field.id;
      const required = schema.required || false;

      // Handle TEXT type (markdown/static text)
      if (field.type === 'TEXT' && schema.static) {
        const textDiv = document.createElement('div');
        textDiv.className = 'text-gray-700 mb-4';
        textDiv.innerHTML = this._markdownToHtml(schema.text || '');
        form.appendChild(textDiv);
        continue;
      }

      // Store the wrapper for visibility control
      fieldWrappers.set(field.id, fieldWrapper);

      // Create label (except for checkbox which has its own layout)
      if (field.type !== 'CHECKBOX') {
        const labelEl = document.createElement('label');
        labelEl.className = 'block text-sm font-medium text-gray-700 mb-2';

        // Add required asterisk in red if needed
        if (required) {
          labelEl.innerHTML = `${label} <span class="text-red-500">*</span>`;
        } else {
          labelEl.textContent = label;
        }

        labelEl.setAttribute('for', field.id);
        fieldWrapper.appendChild(labelEl);
      }

      // Add description as help text if exists
      if (schema.description) {
        const helpText = document.createElement('p');
        helpText.className = 'text-xs text-gray-500 mb-1.5';
        helpText.textContent = schema.description;
        fieldWrapper.appendChild(helpText);
      }

      // Create input based on field type
      let input;

      switch (field.type) {
        case 'TEXT_INPUT':
          input = document.createElement('input');
          input.type = 'text';
          input.className = 'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:border-gray-400';
          if (schema.placeholder) input.placeholder = schema.placeholder;
          if (schema.default) input.value = schema.default;

          input.addEventListener('input', (e) => {
            formValues[schema.name] = e.target.value;
            updateFieldVisibility();
          });
          break;

        case 'EMAIL_INPUT':
          input = document.createElement('input');
          input.type = 'email';
          input.className = 'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:border-gray-400';
          if (schema.placeholder) input.placeholder = schema.placeholder;
          if (schema.default) input.value = schema.default;

          input.addEventListener('input', (e) => {
            formValues[schema.name] = e.target.value;
            updateFieldVisibility();
          });
          break;

        case 'NUMBER_INPUT':
          input = document.createElement('input');
          input.type = 'number';
          input.className = 'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:border-gray-400';
          if (schema.min !== undefined) input.min = schema.min;
          if (schema.max !== undefined) input.max = schema.max;
          if (schema.default) input.value = schema.default;

          input.addEventListener('input', (e) => {
            formValues[schema.name] = parseFloat(e.target.value) || 0;
            updateFieldVisibility();
          });
          break;

        case 'TEXTAREA':
          input = document.createElement('textarea');
          input.className = 'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:border-gray-400';
          input.rows = schema.rows || 4;
          if (schema.placeholder) input.placeholder = schema.placeholder;
          if (schema.default) input.value = schema.default;

          input.addEventListener('input', (e) => {
            formValues[schema.name] = e.target.value;
            updateFieldVisibility();
          });
          break;

        case 'RADIO':
          input = document.createElement('div');
          input.className = 'flex flex-col gap-2.5';

          if (schema.enum && Array.isArray(schema.enum)) {
            schema.enum.forEach((option, idx) => {
              const radioWrapper = document.createElement('div');
              radioWrapper.className = 'flex items-center gap-2.5';

              const radioInput = document.createElement('input');
              radioInput.type = 'radio';
              radioInput.id = `${field.id}_${idx}`;
              radioInput.name = field.id;
              radioInput.value = typeof option === 'object' ? option.value : option;
              radioInput.className = 'h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 flex-shrink-0 self-start mt-0.5';

              if (schema.default && radioInput.value === schema.default) {
                radioInput.checked = true;
              }

              radioInput.addEventListener('change', (e) => {
                if (e.target.checked) {
                  formValues[schema.name] = e.target.value;
                  updateFieldVisibility();
                }
              });

              const radioLabel = document.createElement('label');
              radioLabel.htmlFor = `${field.id}_${idx}`;
              radioLabel.className = 'text-sm text-gray-700 cursor-pointer select-none flex-1';
              radioLabel.textContent = typeof option === 'object' ? option.label : option;

              radioWrapper.appendChild(radioInput);
              radioWrapper.appendChild(radioLabel);
              input.appendChild(radioWrapper);
            });
          }
          break;

        case 'DROPDOWN':
        case 'SELECT':
          const dropdownWrapper = document.createElement('div');
          dropdownWrapper.className = 'w-full';

          const selectInput = document.createElement('select');
          selectInput.className = 'w-full h-[42px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:border-gray-400 appearance-none bg-white';

          // Add placeholder option
          const placeholderOption = document.createElement('option');
          placeholderOption.value = '';
          placeholderOption.textContent = 'Select...';
          selectInput.appendChild(placeholderOption);

          selectInput.addEventListener('change', (e) => {
            formValues[schema.name] = e.target.value;
            updateFieldVisibility();
          });

          // Check for workflow-based options
          if (schema.enumSourceWorkflow) {
            const controlWrapper = document.createElement('div');
            controlWrapper.className = 'flex gap-2 items-start';

            const refreshBtn = document.createElement('button');
            refreshBtn.type = 'button';
            refreshBtn.className = 'material-icons bg-gray-50 text-rewst-teal hover:bg-gray-100 border border-gray-200 rounded-full p-2 transition-colors';
            refreshBtn.textContent = 'refresh';
            refreshBtn.title = 'Refresh options';

            const loadOptions = async () => {
              refreshBtn.classList.add('animate-spin');
              try {
                const workflowConfig = schema.enumSourceWorkflow;

                // Try to get last execution first
                let result;
                try {
                  result = await rewstApp.getLastWorkflowExecution(workflowConfig.id);
                } catch (error) {
                  this._log('No previous execution found, running workflow...');
                  result = await rewstApp.runWorkflowSmart(
                    workflowConfig.id,
                    workflowConfig.input || {}
                  );
                }

                // Clear existing options except placeholder
                selectInput.innerHTML = '';
                selectInput.appendChild(placeholderOption.cloneNode(true));

                // Get the data from output
                const outputData = result.output || result;
                let optionsData = outputData;

                // If data is nested, try to find array
                if (!Array.isArray(optionsData)) {
                  optionsData = Object.values(outputData).find(v => Array.isArray(v)) || [];
                }

                // Store the data
                dynamicFieldsData[field.id] = optionsData;

                // Populate options
                if (Array.isArray(optionsData)) {
                  optionsData.forEach(item => {
                    const option = document.createElement('option');
                    option.value = item[workflowConfig.valueKey] || item.value || item;
                    option.textContent = item[workflowConfig.labelKey] || item.label || item;
                    selectInput.appendChild(option);
                  });
                }
              } catch (error) {
                console.error('Failed to load dropdown options:', error);
                this.showError(`Failed to load options for ${label}`);
              } finally {
                refreshBtn.classList.remove('animate-spin');
              }
            };

            refreshBtn.onclick = loadOptions;

            controlWrapper.appendChild(selectInput);
            controlWrapper.appendChild(refreshBtn);
            dropdownWrapper.appendChild(controlWrapper);

            // Load options on form creation using last execution
            loadOptions();
          } else if (schema.enum && Array.isArray(schema.enum)) {
            // Static options
            schema.enum.forEach(opt => {
              const option = document.createElement('option');
              option.value = typeof opt === 'object' ? opt.value : opt;
              option.textContent = typeof opt === 'object' ? opt.label : opt;
              if (schema.default && option.value === schema.default) {
                option.selected = true;
              }
              selectInput.appendChild(option);
            });
            dropdownWrapper.appendChild(selectInput);
          } else {
            // No options defined
            dropdownWrapper.appendChild(selectInput);
          }

          input = dropdownWrapper;
          break;

        case 'MULTISELECT':
          const multiselectWrapper = document.createElement('div');
          multiselectWrapper.className = 'w-full relative';

          // Store selected values
          const selectedValues = new Set(schema.default || []);

          // Create unified container for tags (acts as the clickable input)
          const tagsContainer = document.createElement('div');
          tagsContainer.className = 'w-full min-h-[52px] px-3 py-2 border-2 border-rewst-light-gray rounded-md focus-within:ring-2 focus-within:ring-rewst-teal focus-within:border-rewst-teal flex flex-wrap gap-2 items-center bg-white cursor-pointer hover:border-rewst-gray transition-colors';

          // Create dropdown menu that appears below
          const dropdownMenu = document.createElement('div');
          dropdownMenu.className = 'hidden absolute z-10 w-full mt-1 bg-white border-2 border-rewst-light-gray rounded-md shadow-rewst max-h-60 overflow-auto';

          let availableOptions = [];

          // Function to render tags inside the input-like container
          const renderTags = () => {
            // Clear existing content
            tagsContainer.innerHTML = '';

            // Add tags for selected values
            if (selectedValues.size > 0) {
              selectedValues.forEach(value => {
                const option = availableOptions.find(opt => opt.value === value);
                const label = option ? option.label : value;

                const tag = document.createElement('div');
                tag.className = 'inline-flex items-center gap-1 px-3 py-1.5 bg-rewst-light-gray text-rewst-dark-gray rounded-full text-sm font-medium';

                const tagLabel = document.createElement('span');
                tagLabel.textContent = label;

                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'material-icons text-rewst-dark-gray hover:text-rewst-black cursor-pointer';
                removeBtn.style.fontSize = '18px';
                removeBtn.textContent = 'close';
                removeBtn.onclick = (e) => {
                  e.stopPropagation();
                  selectedValues.delete(value);
                  formValues[schema.name] = Array.from(selectedValues);
                  renderTags();
                  renderDropdown();
                  updateFieldVisibility();
                };

                tag.appendChild(tagLabel);
                tag.appendChild(removeBtn);
                tagsContainer.appendChild(tag);
              });
            } else {
              // Add placeholder if empty
              const placeholder = document.createElement('span');
              placeholder.className = 'text-rewst-gray text-sm';
              placeholder.textContent = 'Click to select items...';
              tagsContainer.appendChild(placeholder);
            }

            // Add dropdown arrow indicator
            const arrow = document.createElement('span');
            arrow.className = 'material-icons text-rewst-gray ml-auto';
            arrow.style.fontSize = '20px';
            arrow.textContent = 'expand_more';
            tagsContainer.appendChild(arrow);
          };

          // Function to render dropdown options
          const renderDropdown = () => {
            dropdownMenu.innerHTML = '';

            if (availableOptions.length === 0) {
              const emptyMsg = document.createElement('div');
              emptyMsg.className = 'px-3 py-2 text-rewst-gray text-sm';
              emptyMsg.textContent = 'No options available';
              dropdownMenu.appendChild(emptyMsg);
              return;
            }

            availableOptions.forEach(option => {
              const isSelected = selectedValues.has(option.value);

              const optionEl = document.createElement('button');
              optionEl.type = 'button';
              optionEl.className = `w-full px-3 py-2 text-left transition-colors flex items-center justify-between ${isSelected ? 'bg-rewst-light' : ''}`;

              // Add hover state manually since Tailwind hover: doesn't work with custom classes
              optionEl.addEventListener('mouseenter', () => {
                optionEl.style.backgroundColor = 'var(--rewst-light-gray)';
                if (!isSelected) {
                  labelSpan.style.color = 'var(--rewst-teal)';
                }
              });

              optionEl.addEventListener('mouseleave', () => {
                if (!isSelected) {
                  optionEl.style.backgroundColor = '';
                  labelSpan.style.color = '';
                } else {
                  optionEl.style.backgroundColor = 'var(--rewst-light)';
                }
              });

              const labelSpan = document.createElement('span');
              labelSpan.textContent = option.label;
              labelSpan.className = isSelected ? 'text-rewst-teal font-medium' : 'text-rewst-dark-gray';

              const checkIcon = document.createElement('span');
              checkIcon.className = 'material-icons text-rewst-teal';
              checkIcon.style.fontSize = '20px';
              checkIcon.textContent = 'check';
              checkIcon.style.visibility = isSelected ? 'visible' : 'hidden';

              optionEl.appendChild(labelSpan);
              optionEl.appendChild(checkIcon);

              optionEl.onclick = () => {
                if (isSelected) {
                  selectedValues.delete(option.value);
                } else {
                  selectedValues.add(option.value);
                }
                formValues[schema.name] = Array.from(selectedValues);
                renderTags();
                renderDropdown();
                updateFieldVisibility();
              };

              dropdownMenu.appendChild(optionEl);
            });
          };

          // Toggle dropdown when clicking the tags container
          tagsContainer.onclick = (e) => {
            // Don't open if clicking on a remove button
            if (e.target.closest('button[type="button"]')) return;
            dropdownMenu.classList.toggle('hidden');
          };

          // Close dropdown when clicking outside
          document.addEventListener('click', (e) => {
            if (!multiselectWrapper.contains(e.target)) {
              dropdownMenu.classList.add('hidden');
            }
          });

          // Add components to wrapper
          multiselectWrapper.appendChild(tagsContainer);
          multiselectWrapper.appendChild(dropdownMenu);

          // Check for workflow-based options
          if (schema.enumSourceWorkflow) {
            // Add refresh button to the right of the container
            const containerWithRefresh = document.createElement('div');
            containerWithRefresh.className = 'flex gap-2 items-center';

            const refreshBtn = document.createElement('button');
            refreshBtn.type = 'button';
            refreshBtn.className = 'material-icons bg-gray-50 text-rewst-teal hover:bg-rewst-light-gray border border-rewst-light-gray rounded-full p-2 transition-colors';
            refreshBtn.textContent = 'refresh';
            refreshBtn.title = 'Refresh options';

            const loadOptions = async () => {
              refreshBtn.classList.add('animate-spin');
              try {
                const workflowConfig = schema.enumSourceWorkflow;

                // Try to get last execution first
                let result;
                try {
                  result = await rewstApp.getLastWorkflowExecution(workflowConfig.id);
                } catch (error) {
                  this._log('No previous execution found, running workflow...');
                  result = await rewstApp.runWorkflowSmart(
                    workflowConfig.id,
                    workflowConfig.input || {}
                  );
                }

                // Get the data from output
                const outputData = result.output || result;
                let optionsData = outputData;

                // If data is nested, try to find array
                if (!Array.isArray(optionsData)) {
                  optionsData = Object.values(outputData).find(v => Array.isArray(v)) || [];
                }

                // Store the data
                dynamicFieldsData[field.id] = optionsData;

                // Convert to options format
                availableOptions = [];
                if (Array.isArray(optionsData)) {
                  optionsData.forEach(item => {
                    availableOptions.push({
                      value: item[workflowConfig.valueKey] || item.value || item,
                      label: item[workflowConfig.labelKey] || item.label || item
                    });
                  });
                }

                renderTags();
                renderDropdown();
              } catch (error) {
                console.error('Failed to load multiselect options:', error);
                this.showError(`Failed to load options for ${label}`);
              } finally {
                refreshBtn.classList.remove('animate-spin');
              }
            };

            refreshBtn.onclick = loadOptions;

            // Wrap the original wrapper
            containerWithRefresh.appendChild(multiselectWrapper);
            containerWithRefresh.appendChild(refreshBtn);

            // Load options on form creation using last execution
            loadOptions();

            input = containerWithRefresh;
          } else if (schema.items && schema.items.enum) {
            // Static options
            availableOptions = schema.items.enum.map(opt => ({
              value: typeof opt === 'object' ? opt.value : opt,
              label: typeof opt === 'object' ? opt.label : opt
            }));

            renderTags();
            renderDropdown();

            input = multiselectWrapper;
          } else {
            input = multiselectWrapper;
          }

          // Update form values
          formValues[schema.name] = Array.from(selectedValues);

          // Store clear function for form reset
          multiselectClearFunctions.push(() => {
            selectedValues.clear();
            formValues[schema.name] = [];
            renderTags();
            renderDropdown();
          });

          break;

        case 'CHECKBOX':
          const checkboxWrapper = document.createElement('div');
          checkboxWrapper.className = 'flex items-start gap-3';

          input = document.createElement('input');
          input.type = 'checkbox';
          input.className = 'h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded flex-shrink-0 mt-0.5';
          if (schema.default) input.checked = schema.default;

          // CRITICAL: Add change listener for conditional fields
          input.addEventListener('change', (e) => {
            formValues[schema.name] = e.target.checked;
            updateFieldVisibility();
          });

          const checkboxLabel = document.createElement('label');
          checkboxLabel.htmlFor = field.id;
          checkboxLabel.className = 'text-sm text-gray-700 cursor-pointer select-none';
          checkboxLabel.textContent = label;

          checkboxWrapper.appendChild(input);
          checkboxWrapper.appendChild(checkboxLabel);
          fieldWrapper.appendChild(checkboxWrapper);

          input.id = field.id;
          input.name = field.id;
          if (required) input.required = true;

          form.appendChild(fieldWrapper);
          continue;

        case 'DATE':
          input = document.createElement('input');
          input.type = 'date';
          input.className = 'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:border-gray-400';
          if (schema.default) input.value = schema.default;

          input.addEventListener('change', (e) => {
            formValues[schema.name] = e.target.value;
            updateFieldVisibility();
          });
          break;

        default:
          // Default to text input
          input = document.createElement('input');
          input.type = 'text';
          input.className = 'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:border-gray-400';

          input.addEventListener('input', (e) => {
            formValues[schema.name] = e.target.value;
            updateFieldVisibility();
          });
          break;
      }

      // Set id and name on the actual input element (not wrapper)
      // For complex components, the inner input should already have these set
      if (field.type === 'DROPDOWN' || field.type === 'SELECT') {
        // Find the select element inside the wrapper
        const selectEl = input.querySelector('select');
        if (selectEl) {
          selectEl.id = field.id;
          selectEl.name = field.id;
          if (required) selectEl.required = true;
        }
      } else if (field.type === 'MULTISELECT') {
        // MULTISELECT doesn't need name/id as it's tracked in formValues
        // But set on wrapper for identification
        input.dataset.fieldId = field.id;
        input.dataset.fieldName = schema.name;
      } else {
        input.id = field.id;
        input.name = field.id;
        if (required && field.type !== 'CHECKBOX') input.required = true;
      }

      fieldWrapper.appendChild(input);
      form.appendChild(fieldWrapper);
    }

    // Initial visibility evaluation after all fields are created
    updateFieldVisibility();

    // Create submit button using Rewst theme
    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.className = 'btn-primary mt-6';
    submitButton.textContent = 'Submit';
    form.appendChild(submitButton);

    // Handle form submission
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Disable submit button
      submitButton.disabled = true;
      submitButton.textContent = 'Submitting...';

      try {
        // Collect form values for submission using schema.name as keys
        const submissionValues = {};
        sortedFields.forEach(field => {
          // Skip static text fields
          if (field.type === 'TEXT' && field.schema?.static) {
            return;
          }

          // Get the schema name for this field
          const schemaName = field.schema?.name;
          if (!schemaName) return;

          // For MULTISELECT, use the tracked formValues (tags are stored there)
          if (field.type === 'MULTISELECT') {
            submissionValues[schemaName] = formValues[schemaName] || [];
            return;
          }

          const fieldElement = form.querySelector(`[name="${field.id}"]`);

          if (fieldElement) {
            if (field.type === 'CHECKBOX') {
              submissionValues[schemaName] = fieldElement.checked;
            } else if (field.type === 'RADIO') {
              const selected = form.querySelector(`input[name="${field.id}"]:checked`);
              submissionValues[schemaName] = selected ? selected.value : null;
            } else if (field.type === 'NUMBER_INPUT') {
              submissionValues[schemaName] = parseFloat(fieldElement.value) || 0;
            } else {
              submissionValues[schemaName] = fieldElement.value;
            }
          }
        });

        // Get trigger ID (use first trigger if available)
        const triggerId = formData.triggers?.[0]?.id;

        if (!triggerId) {
          throw new Error('No trigger found for this form');
        }

        // Track toasts and timing
        let hasShownProcessing = false;
        let hasShownFinalStatus = false;
        let submittedTime = null;
        let processingTimeout = null;

        // Submit the form with workflow tracking
        const result = await rewstApp.submitForm(
          formId,
          submissionValues,
          triggerId,
          trackWorkflow ? {
            waitForCompletion: true,
            onProgress: (status, tasksComplete) => {
              this._log('Progress status:', status, 'tasksComplete:', tasksComplete);

              if (status === 'submitted') {
                submittedTime = Date.now();
                this.showSuccess('Form submitted successfully!', 3000);
              } else if ((status === 'finding_execution' || status === 'running') && !hasShownProcessing) {
                // Mark as shown immediately to prevent duplicates
                hasShownProcessing = true;

                // Only show processing toast after 1.5 second delay
                const elapsed = Date.now() - submittedTime;
                const delay = Math.max(0, 1500 - elapsed);

                if (processingTimeout) clearTimeout(processingTimeout);

                processingTimeout = setTimeout(() => {
                  const taskText = tasksComplete ? ` (${tasksComplete} tasks)` : '';
                  this.showInfo(`Processing workflow${taskText}...`, 5000);
                }, delay);
              } else if (status === 'SUCCESS' || status === 'succeeded') {
                this._log('Workflow SUCCESS - showing success toast');
                if (processingTimeout) clearTimeout(processingTimeout);
                hasShownFinalStatus = true;
                this.showSuccess('Workflow completed successfully!', 4000);
              } else if (status === 'FAILED' || status === 'failed') {
                this._log('Workflow FAILED - showing error toast');
                if (processingTimeout) clearTimeout(processingTimeout);
                hasShownFinalStatus = true;
                this.showError('Workflow failed', 5000);
              } else {
                this._log('Other workflow status:', status);
              }
            }
          } : undefined
        );

        this._log('Form submission result:', result);

        // Check final result only if we haven't shown a final status toast yet
        if (trackWorkflow && result && !hasShownFinalStatus) {
          if (result.success === true) {
            this._log('Result shows success - showing success toast');
            this.showSuccess('Workflow completed successfully!', 4000);
          } else if (result.success === false) {
            this._log('Result shows failure - showing error toast');
            this.showError('Workflow failed', 5000);
          }
        }

        // Show success toast if not tracking workflow
        if (!trackWorkflow) {
          this.showSuccess('Form submitted successfully!');
        }

        // Slower fade out animation
        form.style.transition = 'opacity 0.6s ease-in-out';
        form.style.opacity = '0.3';

        // After brief fade, reset form
        setTimeout(() => {
          form.reset();

          // Clear all multiselect fields properly
          multiselectClearFunctions.forEach(clearFn => clearFn());

          // Reset formValues to defaults
          sortedFields.forEach(field => {
            if (field.schema?.name) {
              const schema = field.schema;
              let defaultValue = schema.default;

              if (defaultValue === undefined || defaultValue === null) {
                if (field.type === 'CHECKBOX') {
                  defaultValue = false;
                } else if (field.type === 'MULTISELECT') {
                  defaultValue = [];
                } else {
                  defaultValue = null;
                }
              }

              formValues[schema.name] = defaultValue;
            }
          });

          // Update visibility after reset
          updateFieldVisibility();

          // Fade back in
          form.style.opacity = '1';
        }, 600);

        // Call success callback (for additional actions - don't show another success toast here!)
        if (onSubmit) {
          onSubmit(result, submissionValues);
        }

      } catch (error) {
        // Show error toast
        this.showError(`Failed to submit form: ${error.message}`);

        // Call error callback
        if (onError) {
          onError(error);
        }

      } finally {
        // Re-enable submit button
        submitButton.disabled = false;
        submitButton.textContent = 'Submit';
      }
    });

    return form;
  },

  /**
   * Create a chart using Chart.js
   * @param {Array} data - Array of objects to chart (or empty array if using native Chart.js format)
   * @param {Object} options - Configuration options
   * @param {String} options.type - Chart type: 'bar', 'line', 'pie', 'doughnut', 'radar', 'polarArea'
   * @param {String} options.workflowId - Workflow ID for refresh functionality
   * @param {String} options.dataPath - Path to data array in workflow result (e.g., 'output.metrics')
   * @param {Boolean} options.refreshable - Enable refresh button (default: true if workflowId provided)
   * @param {String} options.x OR options.xKey - Field name for x-axis labels (simple format)
   * @param {String|Array} options.y OR options.yKey - Field name(s) for y-axis data (simple format)
   * @param {Array} options.labels - Chart.js native labels array (advanced format)
   * @param {Array} options.datasets - Chart.js native datasets array (advanced format)
   * @param {String} options.title OR options.label - Chart title
   * @param {Object} options.colors - Color scheme { backgroundColor, borderColor }
   * @param {Object} options.chartOptions - Additional Chart.js options
   * @returns {HTMLElement} Container with chart canvas and optional refresh button
   */
  createChart(data, options = {}) {
    // Check if Chart.js is available
    if (typeof Chart === 'undefined') {
      const error = document.createElement('p');
      error.textContent = 'Chart.js library not loaded';
      error.className = 'text-red-500';
      return error;
    }

    const chartType = options.type || 'bar';
    const dataPath = options.dataPath || null;

    // Support both naming conventions
    const xField = options.x || options.xKey;
    const yField = options.y || options.yKey;
    const chartTitle = options.title || options.label || '';

    const workflowId = options.workflowId || null;

    // Refreshable defaults to true if workflowId is provided, but can be overridden
    const refreshable = options.refreshable !== undefined ? options.refreshable : !!workflowId;

    // Get RewstApp instance
    const rewstApp = options.rewstApp || (typeof window !== 'undefined' ? (window.rewstApp || window.rewst) : null);

    // Determine if we can enable refresh
    const canRefresh = refreshable && workflowId && rewstApp;

    // Create container
    const container = document.createElement('div');
    container.className = 'rewst-chart-container w-full';

    // Create top bar with optional refresh button
    if (canRefresh) {
      const topBar = document.createElement('div');
      topBar.className = 'mb-4 flex justify-between items-center';

      const refreshBtn = document.createElement('button');
      refreshBtn.className = 'material-icons bg-gray-50 text-rewst-teal hover:bg-rewst-light-gray border border-rewst-light-gray rounded-full p-2 transition-colors';
      refreshBtn.textContent = 'refresh';
      refreshBtn.title = 'Refresh chart data';

      const spacer = document.createElement('div');

      topBar.appendChild(refreshBtn);
      topBar.appendChild(spacer);
      container.appendChild(topBar);
    }

    // Create canvas wrapper
    const canvasWrapper = document.createElement('div');
    canvasWrapper.className = 'relative w-full';
    canvasWrapper.style.height = options.height || '400px';

    // Create canvas
    const canvas = document.createElement('canvas');
    canvasWrapper.appendChild(canvas);
    container.appendChild(canvasWrapper);

    // Function to prepare chart data
    const prepareChartData = (chartData) => {
      // If user provided native Chart.js format (labels + datasets), use it directly
      if (options.labels && options.datasets) {
        return {
          labels: options.labels,
          datasets: options.datasets
        };
      }

      // If no data provided, return empty
      if (!Array.isArray(chartData) || chartData.length === 0) {
        return { labels: [], datasets: [] };
      }

      // Otherwise, use simple format (extract from data array)
      const labels = chartData.map(item => item[xField]);

      // Auto-assign colors from palette
      const colorPalette = this.chartColorSchemes.multi;

      let datasets = [];
      if (Array.isArray(yField)) {
        // Multiple datasets - assign different color to each
        yField.forEach((field, idx) => {
          const color = colorPalette[idx % colorPalette.length];
          datasets.push({
            label: field,
            data: chartData.map(item => item[field]),
            backgroundColor: color,
            borderColor: color.replace('0.7', '1'),
            borderWidth: 2,
            tension: 0.4  // Smooth lines for line charts
          });
        });
      } else {
        // Single dataset
        const color = options.colors?.backgroundColor || colorPalette[0];
        const borderColor = options.colors?.borderColor || colorPalette[0].replace('0.7', '1');

        datasets.push({
          label: yField,
          data: chartData.map(item => item[yField]),
          backgroundColor: color,
          borderColor: borderColor,
          borderWidth: 2,
          tension: 0.4
        });
      }

      // For doughnut/pie charts, auto-assign different colors to each slice
      if ((chartType === 'doughnut' || chartType === 'pie') && datasets.length === 1) {
        datasets[0].backgroundColor = chartData.map((_, idx) =>
          colorPalette[idx % colorPalette.length]
        );
        datasets[0].borderColor = chartData.map((_, idx) =>
          colorPalette[idx % colorPalette.length].replace('0.7', '1')
        );
      }

      return { labels, datasets };
    };

    // Create chart
    let chartInstance = null;
    const renderChart = (chartData) => {
      // Destroy existing chart
      if (chartInstance) {
        chartInstance.destroy();
      }

      const { labels, datasets } = prepareChartData(chartData);

      chartInstance = new Chart(canvas, {
        type: chartType,
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: {
              display: !!chartTitle,
              text: chartTitle,
              font: { size: 16, weight: 'bold' }
            },
            legend: {
              display: true,
              position: 'top'
            }
          },
          ...options.chartOptions
        }
      });
    };

    // Initial render
    renderChart(data);

    // Setup refresh functionality
    if (canRefresh) {
      const refreshBtn = container.querySelector('button');
      refreshBtn.onclick = async () => {
        refreshBtn.classList.add('animate-spin');
        refreshBtn.disabled = true;

        // Show loading state
        canvasWrapper.style.opacity = '0.5';

        try {
          const result = await rewstApp.runWorkflowSmart(workflowId, {});

          let newData = result;
          if (dataPath) {
            const pathParts = dataPath.split('.');
            for (const part of pathParts) {
              newData = newData[part];
            }
          }

          if (Array.isArray(newData)) {
            data = newData;
            renderChart(data);
            this.showSuccess('Chart refreshed successfully!', 2000);
          } else {
            throw new Error('Refreshed data is not an array');
          }
        } catch (error) {
          console.error('Failed to refresh chart:', error);
          this.showError('Failed to refresh chart data');
        } finally {
          refreshBtn.classList.remove('animate-spin');
          refreshBtn.disabled = false;
          canvasWrapper.style.opacity = '1';
        }
      };
    }

    return container;
  },

  /**
   * Create a card container using Rewst theme
   */
  createCard(content, title = null) {
    const card = document.createElement('div');
    card.className = 'card';

    if (title) {
      const titleEl = document.createElement('h3');
      titleEl.className = 'card-header';
      titleEl.textContent = title;
      card.appendChild(titleEl);
    }

    if (typeof content === 'string') {
      card.innerHTML += content;
    } else {
      card.appendChild(content);
    }

    return card;
  },

  /**
 * Create a metric card (KPI display) using CSS classes from theme
 * @param {Object} options - Configuration
 * @param {String} options.title OR options.label - Main title/label
 * @param {String} options.subtitle OR options.description - Optional subtitle
 * @param {String|Number} options.value - The metric value (large display)
 * @param {String} options.icon - Optional Material Icons name
 * @param {String} options.color - Color theme: 'teal', 'fandango', 'success', 'warning', 'error', 'orange' (default: 'teal')
 * @param {String} options.trend - Optional trend indicator: 'up', 'down', 'neutral'
 * @param {String} options.trendValue - Optional trend value to display (e.g., '+23.5%')
 * @param {Boolean} options.solidBackground - Use card-metric-{color} (default: true) or card card-{color} (false)
 * @param {String} options.cardClass - Override card class entirely (optional)
 * @param {String} options.iconBgClass - Custom icon background class (optional)
 * @param {String} options.iconClass - Custom icon text class (optional)
 */
  createMetricCard(options = {}) {
    const {
      value = '0',
      icon = null,
      color = 'teal',
      trend = null,
      trendValue = null,
      solidBackground = true,
      cardClass = null,
      iconBgClass = null,
      iconClass = null
    } = options;

    // Support both naming conventions
    const title = options.title || options.label || 'Metric';
    const subtitle = options.subtitle || options.description || null;

    const card = document.createElement('div');

    // Use custom cardClass if provided, otherwise build from solidBackground setting
    // Class order: w-full card card-metric card-metric-{color} OR card card-metric card-{color}
    // Always include w-full to ensure cards fill their container
    if (cardClass) {
      card.className = `w-full card card-metric ${cardClass}`;
    } else if (solidBackground === true) {
      card.className = `w-full card card-metric card-metric-${color}`;
    } else {
      card.className = `w-full card card-metric card-${color}`;
    }

    // Header with title/subtitle and optional icon
    const header = document.createElement('div');
    header.className = 'flex items-start justify-between mb-4';

    const titleSection = document.createElement('div');
    titleSection.className = 'flex-1';

    const titleEl = document.createElement('h3');
    titleEl.className = (solidBackground === true) ? 'text-sm font-medium text-white/90 mb-1' : 'text-sm font-medium text-rewst-dark-gray mb-1';
    titleEl.textContent = title;
    titleSection.appendChild(titleEl);

    if (subtitle) {
      const subtitleEl = document.createElement('p');
      subtitleEl.className = (solidBackground === true) ? 'text-xs text-white/70' : 'text-xs text-rewst-gray';
      subtitleEl.textContent = subtitle;
      titleSection.appendChild(subtitleEl);
    }

    header.appendChild(titleSection);

    // Optional icon with background
    if (icon) {
      const iconWrapper = document.createElement('div');
      if (iconBgClass) {
        iconWrapper.className = iconBgClass;
      } else {
        iconWrapper.className = (solidBackground === true) ? 'bg-white/20 rounded-full p-3' : 'bg-rewst-light rounded-full p-3';
      }

      const iconEl = document.createElement('span');
      iconEl.className = 'material-icons';
      if (iconClass) {
        iconEl.className += ' ' + iconClass;
      } else if (solidBackground === true) {
        iconEl.className += ' text-white';
      } else {
        iconEl.className += ` text-rewst-${color}`;
      }
      iconEl.style.fontSize = '24px';
      iconEl.textContent = icon;

      iconWrapper.appendChild(iconEl);
      header.appendChild(iconWrapper);
    }

    card.appendChild(header);

    // Large metric value
    const valueEl = document.createElement('div');
    valueEl.className = (solidBackground === true) ? 'text-4xl font-bold text-white mb-2' : `text-4xl font-bold text-rewst-${color} mb-2`;
    valueEl.textContent = value;
    card.appendChild(valueEl);

    // Optional trend indicator
    if (trend && trendValue) {
      const trendWrapper = document.createElement('div');
      trendWrapper.className = 'flex items-center gap-1';

      const trendIcon = document.createElement('span');
      trendIcon.className = 'material-icons text-sm';

      let trendColorClass = '';
      if (trend === 'up') {
        trendIcon.textContent = 'trending_up';
        trendColorClass = (solidBackground === true) ? 'text-white/90' : 'text-green-600';
      } else if (trend === 'down') {
        trendIcon.textContent = 'trending_down';
        trendColorClass = (solidBackground === true) ? 'text-white/90' : 'text-red-600';
      } else {
        trendIcon.textContent = 'remove';
        trendColorClass = (solidBackground === true) ? 'text-white/90' : 'text-gray-600';
      }

      if (trendColorClass) {
        trendIcon.className += ' ' + trendColorClass;
      }

      const trendText = document.createElement('span');
      trendText.className = 'text-sm font-medium';
      if (trendColorClass) {
        trendText.className += ' ' + trendColorClass;
      }
      trendText.textContent = trendValue;

      trendWrapper.appendChild(trendIcon);
      trendWrapper.appendChild(trendText);
      card.appendChild(trendWrapper);
    }

    return card;
  },

  /**
   * Create a list from an array
   */
  createList(items, ordered = false) {
    const list = document.createElement(ordered ? 'ol' : 'ul');
    list.className = ordered
      ? 'list-decimal list-inside space-y-1'
      : 'list-disc list-inside space-y-1';

    items.forEach(item => {
      const li = document.createElement('li');
      li.className = 'text-gray-700';
      li.textContent = typeof item === 'object' ? JSON.stringify(item) : item;
      list.appendChild(li);
    });

    return list;
  },

  /**
   * Syntax highlight JSON string
   * @private
   */
  _syntaxHighlightJSON(json) {
    if (typeof json !== 'string') {
      json = JSON.stringify(json, null, 2);
    }

    // Replace special characters and add color classes
    json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // First, color the values
    json = json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
      let cls = 'text-emerald-300'; // numbers

      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = 'text-cyan-400'; // keys
        } else {
          cls = 'text-amber-300'; // string values
        }
      } else if (/true|false/.test(match)) {
        cls = 'text-purple-400'; // booleans
      } else if (/null/.test(match)) {
        cls = 'text-purple-400'; // null
      }

      return '<span class="' + cls + '">' + match + '</span>';
    });

    // Then, color the structural characters (brackets, braces, colons, commas)
    json = json.replace(/([{}\[\],:])/g, '<span class="text-gray-400">$1</span>');

    return json;
  },

  /**
   * Create a key-value display
   */
  createKeyValue(data) {
    const dl = document.createElement('dl');
    dl.className = 'grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2';

    Object.entries(data).forEach(([key, value]) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'sm:col-span-1';

      const dt = document.createElement('dt');
      dt.className = 'text-sm font-medium text-gray-500';
      dt.textContent = key.replace(/_/g, ' ');

      const dd = document.createElement('dd');
      dd.className = 'mt-1 text-sm';

      // Handle objects with pretty formatting and syntax highlighting
      if (typeof value === 'object' && value !== null) {
        const pre = document.createElement('pre');
        pre.className = 'bg-gray-900 p-3 rounded text-xs overflow-x-auto font-mono leading-relaxed';
        pre.innerHTML = this._syntaxHighlightJSON(value);
        dd.appendChild(pre);
      } else {
        dd.className += ' text-gray-900';
        dd.textContent = value;
      }

      wrapper.appendChild(dt);
      wrapper.appendChild(dd);
      dl.appendChild(wrapper);
    });

    return dl;
  },

  /**
   * Create an autocomplete/searchable dropdown component
   * @param {Array} items - Array of items to search through
   * @param {Object} options - Configuration options
   * @param {String} options.labelKey - Key to use for display label (default: 'label' or 'name')
   * @param {String} options.valueKey - Key to use for value (default: 'value' or 'id')
   * @param {String} options.placeholder - Placeholder text (default: 'Search...')
   * @param {Function} options.onSelect - Callback when item selected (item) => {}
   * @param {Function} options.searchFn - Custom search function (item, searchTerm) => boolean
   * @param {Boolean} options.showClearButton - Show X button to clear selection (default: true)
   * @param {String} options.noResultsText - Text when no results (default: 'No results found')
   * @param {Number} options.maxResults - Maximum results to show (default: 10)
   * @returns {HTMLElement} Autocomplete container
   */
  createAutocomplete(items, options = {}) {
    const {
      labelKey = items[0]?.label !== undefined ? 'label' : 'name',
      valueKey = items[0]?.value !== undefined ? 'value' : 'id',
      placeholder = 'Search...',
      onSelect = null,
      searchFn = null,
      showClearButton = true,
      noResultsText = 'No results found',
      maxResults = 10
    } = options;

    // State
    let selectedItem = null;
    let filteredItems = [];
    let highlightedIndex = -1;
    let isDropdownOpen = false;

    // Create container
    const container = document.createElement('div');
    container.className = 'relative w-full';

    // Create input wrapper
    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'relative';

    // Create search input
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.className = 'w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-rewst-teal focus:border-rewst-teal';

    // Create dropdown arrow button
    const dropdownBtn = document.createElement('button');
    dropdownBtn.type = 'button';
    dropdownBtn.className = 'material-icons absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer transition-transform';
    dropdownBtn.style.fontSize = '20px';
    dropdownBtn.textContent = 'arrow_drop_down';

    // Create clear button (hidden by default)
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'material-icons absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer';
    clearBtn.style.fontSize = '20px';
    clearBtn.textContent = 'close';
    clearBtn.style.display = 'none'; // Hidden by default

    inputWrapper.appendChild(input);
    inputWrapper.appendChild(dropdownBtn);
    if (showClearButton) {
      inputWrapper.appendChild(clearBtn);
    }
    container.appendChild(inputWrapper);

    // Create dropdown
    const dropdown = document.createElement('div');
    dropdown.className = 'hidden absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto';
    container.appendChild(dropdown);

    // Default search function
    const defaultSearchFn = (item, searchTerm) => {
      const label = String(item[labelKey] || '').toLowerCase();
      const value = String(item[valueKey] || '').toLowerCase();
      const search = searchTerm.toLowerCase();
      return label.includes(search) || value.includes(search);
    };

    const searchFunction = searchFn || defaultSearchFn;

    // Render dropdown results
    const renderDropdown = () => {
      dropdown.innerHTML = '';
      highlightedIndex = -1;

      if (filteredItems.length === 0) {
        const noResults = document.createElement('div');
        noResults.className = 'px-3 py-2 text-sm text-gray-500 italic';
        noResults.textContent = noResultsText;
        dropdown.appendChild(noResults);
        return;
      }

      // Limit results
      const displayItems = filteredItems.slice(0, maxResults);

      displayItems.forEach((item, idx) => {
        const itemEl = document.createElement('button');
        itemEl.type = 'button';
        itemEl.className = 'w-full px-3 py-2 text-left text-sm hover:bg-rewst-light transition-colors cursor-pointer';
        itemEl.textContent = item[labelKey];
        itemEl.dataset.index = idx;

        itemEl.addEventListener('click', () => {
          selectItem(item);
        });

        itemEl.addEventListener('mouseenter', () => {
          highlightedIndex = idx;
          updateHighlight();
        });

        dropdown.appendChild(itemEl);
      });

      if (filteredItems.length > maxResults) {
        const moreResults = document.createElement('div');
        moreResults.className = 'px-3 py-2 text-sm text-gray-500 italic border-t border-gray-200';
        moreResults.textContent = `${filteredItems.length - maxResults} more results...`;
        dropdown.appendChild(moreResults);
      }
    };

    // Update highlighted item
    const updateHighlight = () => {
      const items = dropdown.querySelectorAll('button');
      items.forEach((item, idx) => {
        if (idx === highlightedIndex) {
          item.classList.add('bg-rewst-light');
        } else {
          item.classList.remove('bg-rewst-light');
        }
      });
    };

    // Select an item
    const selectItem = (item) => {
      selectedItem = item;
      input.value = item[labelKey];
      dropdown.classList.add('hidden');
      isDropdownOpen = false;

      // Show clear button, hide dropdown arrow
      if (showClearButton) {
        clearBtn.style.display = '';
        dropdownBtn.style.display = 'none';
      }

      // Callback
      if (onSelect) {
        onSelect(item);
      }
    };

    // Clear selection
    const clearSelection = () => {
      selectedItem = null;
      input.value = '';
      dropdown.classList.add('hidden');
      isDropdownOpen = false;

      // Hide clear button, show dropdown arrow
      if (showClearButton) {
        clearBtn.style.display = 'none';
        dropdownBtn.style.display = '';
      }

      input.focus();
    };

    // Show dropdown with all or filtered items
    const showDropdown = () => {
      const searchTerm = input.value.trim();

      if (searchTerm === '') {
        // Show all items when empty
        filteredItems = [...items];
      } else {
        // Filter items based on search
        filteredItems = items.filter(item => searchFunction(item, searchTerm));
      }

      renderDropdown();
      dropdown.classList.remove('hidden');
      isDropdownOpen = true;
    };

    // Hide dropdown
    const hideDropdown = () => {
      dropdown.classList.add('hidden');
      isDropdownOpen = false;
    };

    // Input event - filter and show dropdown
    input.addEventListener('input', (e) => {
      const searchTerm = e.target.value.trim();

      if (searchTerm === '') {
        filteredItems = [...items];
      } else {
        filteredItems = items.filter(item => searchFunction(item, searchTerm));
      }

      renderDropdown();
      dropdown.classList.remove('hidden');
      isDropdownOpen = true;
    });

    // Focus - show dropdown (only if not already open)
    input.addEventListener('focus', () => {
      if (!isDropdownOpen) {
        showDropdown();
      }
    });

    // Dropdown arrow button click - toggle dropdown
    dropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isDropdownOpen) {
        hideDropdown();
      } else {
        input.focus();
        showDropdown();
      }
    });

    // Keyboard navigation
    input.addEventListener('keydown', (e) => {
      const itemCount = Math.min(filteredItems.length, maxResults);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!isDropdownOpen) {
          showDropdown();
        }
        highlightedIndex = Math.min(highlightedIndex + 1, itemCount - 1);
        updateHighlight();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightedIndex = Math.max(highlightedIndex - 1, 0);
        updateHighlight();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < itemCount) {
          selectItem(filteredItems[highlightedIndex]);
        }
      } else if (e.key === 'Escape') {
        hideDropdown();
        input.blur();
      }
    });

    // Clear button click
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearSelection();
    });

    // Click outside to close
    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) {
        hideDropdown();
      }
    });

    // Public API
    container.getValue = () => selectedItem ? selectedItem[valueKey] : null;
    container.getSelectedItem = () => selectedItem;
    container.setValue = (value) => {
      const item = items.find(i => i[valueKey] === value);
      if (item) {
        selectItem(item);
      }
    };
    container.clear = () => clearSelection();

    return container;
  },

  /**
   * Get or create toast container
   * @private
   */
  _getToastContainer() {
    let container = document.getElementById('rewst-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'rewst-toast-container';
      container.className = 'fixed top-4 right-4 z-50 space-y-2';
      document.body.appendChild(container);
    }
    return container;
  },

  /**
   * Show a toast notification using Rewst alert styles
   * @param {String} message - Message to display
   * @param {String} type - Type of toast: 'success', 'warning', 'error', 'info'
   * @param {Number} duration - Duration in ms (default: 4000)
   */
  showToast(message, type = 'info', duration = 4000) {
    const container = this._getToastContainer();

    // Create toast element using alert classes
    const toast = document.createElement('div');
    toast.className = 'alert min-w-[320px] max-w-md transform translate-x-full transition-transform duration-300 ease-out';
    toast.style.opacity = '1'; // Force full opacity

    // Add type-specific alert class
    const alertTypes = {
      success: 'alert-success',
      warning: 'alert-warning',
      error: 'alert-error',
      info: 'alert-info'
    };
    toast.className += ' ' + (alertTypes[type] || alertTypes.info);

    // Create icon
    const icon = document.createElement('span');
    icon.className = 'material-icons';
    const icons = {
      success: 'check_circle',
      warning: 'warning',
      error: 'error',
      info: 'info'
    };
    icon.textContent = icons[type] || icons.info;

    // Create message container
    const messageContainer = document.createElement('div');
    messageContainer.className = 'flex-1';

    // Add message text
    const messageText = document.createElement('span');
    messageText.textContent = message;
    messageContainer.appendChild(messageText);

    // Create close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'material-icons ml-auto opacity-70 hover:opacity-100 transition-opacity cursor-pointer';
    closeBtn.textContent = 'close';
    closeBtn.style.fontSize = '20px';
    closeBtn.onclick = () => this._removeToast(toast);

    // Assemble toast
    toast.appendChild(icon);
    toast.appendChild(messageContainer);
    toast.appendChild(closeBtn);
    container.appendChild(toast);

    // Trigger slide-in animation
    setTimeout(() => {
      toast.classList.remove('translate-x-full');
      toast.classList.add('translate-x-0');
    }, 10);

    // Auto-dismiss
    if (duration > 0) {
      setTimeout(() => {
        this._removeToast(toast);
      }, duration);
    }

    return toast;
  },

  /**
   * Remove a toast with fade-out animation
   * @private
   */
  _removeToast(toast) {
    toast.classList.add('translate-x-full', 'opacity-0');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  },

  /**
   * Show success toast
   * @param {String} message - Success message
   * @param {Number} duration - Duration in ms (default: 4000)
   */
  showSuccess(message, duration = 4000) {
    return this.showToast(message, 'success', duration);
  },

  /**
   * Show warning toast
   * @param {String} message - Warning message
   * @param {Number} duration - Duration in ms (default: 4000)
   */
  showWarning(message, duration = 4000) {
    return this.showToast(message, 'warning', duration);
  },

  /**
   * Show error toast
   * @param {String} message - Error message
   * @param {Number} duration - Duration in ms (default: 5000)
   */
  showError(message, duration = 5000) {
    return this.showToast(message, 'error', duration);
  },

  /**
   * Show info toast
   * @param {String} message - Info message
   * @param {Number} duration - Duration in ms (default: 4000)
   */
  showInfo(message, duration = 4000) {
    return this.showToast(message, 'info', duration);
  },

  /**
   * Rewst Color Palette - Master color reference
   * Maps color names to their CSS variable names and provides RGB values
   */
  colors: {
    // Primary Brand Colors
    teal: '--rewst-teal',
    fandango: '--rewst-fandango',

    // Semantic Colors
    success: '--rewst-success',
    warning: '--rewst-warning',
    error: '--rewst-error',
    info: '--rewst-info',

    // Accent Colors
    orange: '--rewst-orange',
    purple: '--rewst-purple',
    blue: '--rewst-blue',

    // Neutral Colors
    black: '--rewst-black',
    'dark-gray': '--rewst-dark-gray',
    gray: '--rewst-gray',
    'light-gray': '--rewst-light-gray',
    light: '--rewst-light',
    white: '--rewst-white',

    // Background Colors
    background: '--rewst-background',
    'card-bg': '--rewst-card-bg'
  },

  /**
   * Get Rewst theme color from CSS variable
   * @param {String} colorName - Color name (e.g., 'teal', 'orange', 'success')
   * @returns {String} Hex color value
   */
  getColor(colorName) {
    const varName = this.colors[colorName] || `--rewst-${colorName}`;
    const color = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return color || null;
  },

  /**
   * Convert hex color to RGB array [r, g, b]
   * @param {String} hex - Hex color (e.g., '#009490')
   * @returns {Array} RGB values [r, g, b]
   */
  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
      parseInt(result[1], 16),
      parseInt(result[2], 16),
      parseInt(result[3], 16)
    ] : null;
  },

  /**
   * Get Rewst color as RGB string
   * @param {String} colorName - Color name
   * @returns {String} RGB string (e.g., 'rgb(0, 148, 144)')
   */
  getColorRgb(colorName) {
    const hex = this.getColor(colorName);
    if (!hex) return null;

    const rgb = this.hexToRgb(hex);
    if (!rgb) return null;

    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  },

  /**
   * Get Rewst color as RGBA string with opacity
   * @param {String} colorName - Color name
   * @param {Number} opacity - Opacity from 0 to 1 (e.g., 0.5 for 50%)
   * @returns {String} RGBA string (e.g., 'rgba(0, 148, 144, 0.5)')
   */
  getColorRgba(colorName, opacity = 1) {
    const hex = this.getColor(colorName);
    if (!hex) return null;

    const rgb = this.hexToRgb(hex);
    if (!rgb) return null;

    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${opacity})`;
  },

  /**
   * Get Rewst color in various formats
   * @param {String} colorName - Color name
   * @param {Object} options - Format options
   * @param {String} options.format - 'hex', 'rgb', 'rgba' (default: 'hex')
   * @param {Number} options.opacity - Opacity for rgba format (default: 1)
   * @returns {String} Color in requested format
   */
  getRewstColor(colorName, options = {}) {
    const { format = 'hex', opacity = 1 } = options;

    switch (format) {
      case 'rgb':
        return this.getColorRgb(colorName);
      case 'rgba':
        return this.getColorRgba(colorName, opacity);
      case 'hex':
      default:
        return this.getColor(colorName);
    }
  },

  /**
   * Predefined color schemes for charts
   */
  chartColorSchemes: {
    primary: {
      backgroundColor: 'rgba(0, 148, 144, 0.5)',
      borderColor: 'rgba(0, 148, 144, 1)',
      pointBackgroundColor: 'rgba(0, 148, 144, 1)',
      pointBorderColor: '#fff'
    },
    accent: {
      backgroundColor: 'rgba(255, 121, 63, 0.5)',
      borderColor: 'rgba(255, 121, 63, 1)',
      pointBackgroundColor: 'rgba(255, 121, 63, 1)',
      pointBorderColor: '#fff'
    },
    success: {
      backgroundColor: 'rgba(34, 197, 94, 0.5)',
      borderColor: 'rgba(34, 197, 94, 1)',
      pointBackgroundColor: 'rgba(34, 197, 94, 1)',
      pointBorderColor: '#fff'
    },
    warning: {
      backgroundColor: 'rgba(234, 179, 8, 0.5)',
      borderColor: 'rgba(234, 179, 8, 1)',
      pointBackgroundColor: 'rgba(234, 179, 8, 1)',
      pointBorderColor: '#fff'
    },
    error: {
      backgroundColor: 'rgba(239, 68, 68, 0.5)',
      borderColor: 'rgba(239, 68, 68, 1)',
      pointBackgroundColor: 'rgba(239, 68, 68, 1)',
      pointBorderColor: '#fff'
    },
    multi: [
      'rgba(0, 148, 144, 0.7)',    // Teal
      'rgba(255, 121, 63, 0.7)',   // Orange
      'rgba(139, 92, 246, 0.7)',   // Purple
      'rgba(34, 197, 94, 0.7)',    // Success
      'rgba(234, 179, 8, 0.7)',    // Warning
      'rgba(59, 130, 246, 0.7)'    // Blue
    ]
  },

  /**
   * Get chart color scheme
   * @param {String} scheme - Scheme name: 'primary', 'accent', 'success', 'warning', 'error', 'multi'
   * @returns {Object|Array} Color scheme object or array
   */
  getChartColors(scheme = 'primary') {
    return this.chartColorSchemes[scheme] || this.chartColorSchemes.primary;
  },

        /**
     * Animate a number counting up
     * @param {HTMLElement} element - The element to animate
     * @param {String|Number} finalValue - The final value (can include $, %, commas, etc.)
     * @param {Number} duration - Animation duration in ms (default: 1000)
     */
      animateNumber(element, finalValue, duration = 1000) {
            const numericValue = parseFloat(String(finalValue).replace(/[^0-9.-]/g, ''));
            
            if (isNaN(numericValue) || numericValue === 0) {
              element.textContent = finalValue;
              return;
            }
            
            // Extract prefix/suffix (like $ or %)
            const valueStr = String(finalValue);
            const prefix = valueStr.match(/^[^0-9.-]+/)?.[0] || '';
            const suffix = valueStr.match(/[^0-9.,]+$/)?.[0] || '';
            
            // Start at 0
            element.textContent = prefix + '0' + suffix;
            
            const startTime = performance.now();
            const hasCommas = valueStr.includes(',');
            const hasDecimals = valueStr.includes('.');
            
            function animate(currentTime) {
              const elapsed = currentTime - startTime;
              const progress = Math.min(elapsed / duration, 1);
              
              // Easing function (ease-out-cubic)
              const eased = 1 - Math.pow(1 - progress, 3);
              const current = numericValue * eased;
              
              // Format the number
              let displayValue;
              if (hasCommas) {
                displayValue = Math.floor(current).toLocaleString();
              } else if (hasDecimals) {
                displayValue = current.toFixed(1);
              } else {
                displayValue = Math.floor(current).toString();
              }
              
              element.textContent = prefix + displayValue + suffix;
              
              if (progress < 1) {
                requestAnimationFrame(animate);
              } else {
                element.textContent = finalValue; // Set exact final value
              }
            }
            
            requestAnimationFrame(animate);
          }
};

// Make available globally
if (typeof window !== 'undefined') {
  window.RewstDOM = RewstDOM;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RewstDOM;
}