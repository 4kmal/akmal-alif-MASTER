// Blog Category Filter Functionality
function initBlogFilters() {
    const categoryButtons = document.querySelectorAll('.category-btn');
    const blogCards = document.querySelectorAll('.blog-card');

    if (!categoryButtons.length || !blogCards.length) return;

    // Set category colors for tags
    function setCategoryColors() {
        blogCards.forEach(card => {
            const categoryTag = card.querySelector('.blog-category-tag');
            const category = card.getAttribute('data-category');
            
            if (categoryTag && category) {
                categoryTag.classList.add(category);
            }
        });
    }

    // Add click event listeners to category buttons
    categoryButtons.forEach(button => {
        if (button.dataset.filterBound === 'true') return;
        button.dataset.filterBound = 'true';

        button.addEventListener('click', function() {
            const selectedCategory = this.getAttribute('data-category');
            
            // Update active button
            categoryButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
            
            // Filter blog cards with animation
            blogCards.forEach((card, index) => {
                const cardCategory = card.getAttribute('data-category');
                
                if (selectedCategory === 'all' || cardCategory === selectedCategory) {
                    card.style.display = 'block';
                    
                    // Stagger the animation
                    setTimeout(() => {
                        card.style.opacity = '1';
                        card.style.transform = 'translateY(0)';
                    }, index * 100);
                } else {
                    card.style.opacity = '0';
                    card.style.transform = 'translateY(30px)';
                    
                    setTimeout(() => {
                        card.style.display = 'none';
                    }, 300);
                }
            });
            
        });
    });

    // Initialize colors and show all posts
    setCategoryColors();
    
    // Set initial animation states
    blogCards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(30px)';
        card.style.transition = 'all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        
        // Stagger initial animation
        setTimeout(() => {
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, index * 150);
    });
}

document.addEventListener('DOMContentLoaded', initBlogFilters);
document.addEventListener('blog:rendered', initBlogFilters);
