function initializeNewMobileMenu() {
  const mobileMenuButton = document.querySelector('.mobile-menu-button');
  const mobileMenuDropdown = document.querySelector('.mobile-menu-dropdown');
  const mobileMenuContent = document.getElementById('mobileMenuContent');

  if (!mobileMenuButton || !mobileMenuDropdown) {
    console.warn('Mobile menu elements not found:', {
      mobileMenuButton: !!mobileMenuButton,
      mobileMenuDropdown: !!mobileMenuDropdown,
      mobileMenuContent: !!mobileMenuContent
    });
    return;
  }

  // Check if already initialized to prevent duplicate event listeners
  if (mobileMenuButton.getAttribute('data-menu-listener-attached')) {
    console.log('Mobile menu already initialized, skipping...');
    return;
  }

  console.log('Initializing mobile menu functionality');

  // Mark that we've attached listeners to prevent duplicates
  mobileMenuButton.setAttribute('data-menu-listener-attached', 'true');

  // Add visual feedback to confirm the button is active
  mobileMenuButton.style.opacity = '1';
  mobileMenuButton.style.pointerEvents = 'auto';

  // Toggle mobile dropdown menu when hamburger button is clicked
  if (mobileMenuButton && mobileMenuDropdown) {
    mobileMenuButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      console.log('Mobile menu button clicked!');
      
      const isActive = mobileMenuDropdown.classList.contains('active');
      console.log(isActive ? 'Closing mobile menu' : 'Opening mobile menu');
      
      mobileMenuDropdown.classList.toggle('active');
      mobileMenuButton.classList.toggle('active');
      
      // Add/remove class to body to prevent scroll when menu is open
      document.body.classList.toggle('mobile-menu-open');
    });
  }

  // Close mobile menu when clicking outside
  document.addEventListener('click', (event) => {
    if (mobileMenuDropdown && mobileMenuDropdown.classList.contains('active')) {
      // Check if click is outside the mobile menu and not on the hamburger button
      if (!mobileMenuDropdown.contains(event.target) && !mobileMenuButton.contains(event.target)) {
        mobileMenuDropdown.classList.remove('active');
        mobileMenuButton.classList.remove('active');
        document.body.classList.remove('mobile-menu-open');
      }
    }
  });

  // Handle nested dropdown functionality (About menu)
  const mobileNestedDropdowns = document.querySelectorAll('.mobile-nested-dropdown');
  mobileNestedDropdowns.forEach(dropdown => {
    const trigger = dropdown.querySelector('.mobile-menu-trigger');
    
    if (trigger) {
      // Handle click for mobile touch devices
      trigger.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        
        // Toggle active state for this dropdown
        dropdown.classList.toggle('active');
        
        // Close other nested dropdowns
        mobileNestedDropdowns.forEach(otherDropdown => {
          if (otherDropdown !== dropdown) {
            otherDropdown.classList.remove('active');
          }
        });
      });

      // Handle hover for desktop/larger touch devices
      dropdown.addEventListener('mouseenter', () => {
        dropdown.classList.add('active');
      });

      dropdown.addEventListener('mouseleave', () => {
        dropdown.classList.remove('active');
      });
    }
  });

  // Close nested dropdowns when clicking on submenu links
  const mobileSubmenuLinks = document.querySelectorAll('.mobile-submenu-link');
  mobileSubmenuLinks.forEach(link => {
    link.addEventListener('click', () => {
      // Close all nested dropdowns
      mobileNestedDropdowns.forEach(dropdown => {
        dropdown.classList.remove('active');
      });
      
      // Close main mobile menu
      if (mobileMenuDropdown) {
        mobileMenuDropdown.classList.remove('active');
        mobileMenuButton.classList.remove('active');
        document.body.classList.remove('mobile-menu-open');
      }
    });
  });

  // Close mobile menu when clicking on main menu links
  const mobileMenuLinks = document.querySelectorAll('.mobile-menu-link');
  mobileMenuLinks.forEach(link => {
    link.addEventListener('click', () => {
      // Close main mobile menu
      if (mobileMenuDropdown) {
        mobileMenuDropdown.classList.remove('active');
        mobileMenuButton.classList.remove('active');
        document.body.classList.remove('mobile-menu-open');
      }
    });
  });

  // Handle escape key to close mobile menu
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (mobileMenuDropdown && mobileMenuDropdown.classList.contains('active')) {
        mobileMenuDropdown.classList.remove('active');
        mobileMenuButton.classList.remove('active');
        document.body.classList.remove('mobile-menu-open');
        
        // Close all nested dropdowns
        mobileNestedDropdowns.forEach(dropdown => {
          dropdown.classList.remove('active');
        });
      }
    }
  });

  // Handle window resize to close mobile menu on larger screens
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      if (mobileMenuDropdown) {
        mobileMenuDropdown.classList.remove('active');
        mobileMenuButton.classList.remove('active');
        document.body.classList.remove('mobile-menu-open');
      }
      
      // Close all nested dropdowns
      mobileNestedDropdowns.forEach(dropdown => {
        dropdown.classList.remove('active');
      });
    }
  });
}

// Fallback initialization - retry after a delay if initial attempt failed
function initializeMobileMenuFallback() {
  setTimeout(() => {
    const mobileMenuButton = document.querySelector('.mobile-menu-button');
    const mobileMenuDropdown = document.querySelector('.mobile-menu-dropdown');
    
    if (mobileMenuButton && mobileMenuDropdown) {
      // Check if event listener is already attached
      if (!mobileMenuButton.getAttribute('data-menu-listener-attached')) {
        console.log('Fallback: Initializing mobile menu functionality');
        initializeNewMobileMenu();
      }
    } else {
      console.log('Fallback: Mobile menu elements still not available');
    }
  }, 1000); // Wait 1 second for all elements to load
}

// Call fallback initialization
initializeMobileMenuFallback();

// If you want to ensure it runs after the DOM is loaded when this script is included directly
// and not called by another script, you could use:
// document.addEventListener('DOMContentLoaded', initializeNewMobileMenu);
// However, in this case, script.js will call it after partials are loaded. 