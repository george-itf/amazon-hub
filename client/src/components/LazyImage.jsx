import React, { useState, useRef, useEffect, memo } from 'react';

/**
 * LazyImage - Image component with lazy loading and placeholder
 *
 * Features:
 * - Lazy loads images when they enter the viewport
 * - Shows placeholder while loading
 * - Handles load errors gracefully
 * - Supports blur-up animation
 */
const LazyImage = memo(function LazyImage({
  src,
  alt = '',
  width,
  height,
  className = '',
  style = {},
  placeholder = null,
  onLoad,
  onError,
  threshold = 0.1,
  rootMargin = '50px',
  ...props
}) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const [hasError, setHasError] = useState(false);
  const imgRef = useRef(null);

  useEffect(() => {
    if (!imgRef.current) return;

    // Use IntersectionObserver for lazy loading
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(imgRef.current);

    return () => observer.disconnect();
  }, [threshold, rootMargin]);

  const handleLoad = (e) => {
    setIsLoaded(true);
    onLoad?.(e);
  };

  const handleError = (e) => {
    setHasError(true);
    onError?.(e);
  };

  const containerStyle = {
    position: 'relative',
    overflow: 'hidden',
    width: width || 'auto',
    height: height || 'auto',
    backgroundColor: 'var(--hub-bg-secondary, #f0f0f0)',
    ...style,
  };

  const imgStyle = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    transition: 'opacity 0.3s ease, filter 0.3s ease',
    opacity: isLoaded ? 1 : 0,
    filter: isLoaded ? 'none' : 'blur(10px)',
  };

  const placeholderStyle = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--hub-text-muted)',
    fontSize: '12px',
  };

  // Default placeholder content
  const defaultPlaceholder = (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21,15 16,10 5,21" />
    </svg>
  );

  return (
    <div ref={imgRef} className={className} style={containerStyle}>
      {/* Placeholder shown while loading or on error */}
      {(!isLoaded || hasError) && (
        <div style={placeholderStyle}>
          {hasError ? (
            <span>Failed to load</span>
          ) : (
            placeholder || defaultPlaceholder
          )}
        </div>
      )}

      {/* Actual image - only load src when in view */}
      {isInView && !hasError && (
        <img
          src={src}
          alt={alt}
          style={imgStyle}
          onLoad={handleLoad}
          onError={handleError}
          loading="lazy"
          decoding="async"
          {...props}
        />
      )}
    </div>
  );
});

/**
 * ProductImage - Specialized lazy image for product thumbnails
 */
export const ProductImage = memo(function ProductImage({
  src,
  alt,
  size = 48,
  className = '',
  ...props
}) {
  return (
    <LazyImage
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={{
        borderRadius: 'var(--hub-radius-sm)',
        flexShrink: 0,
      }}
      {...props}
    />
  );
});

/**
 * AvatarImage - Specialized lazy image for user avatars
 */
export const AvatarImage = memo(function AvatarImage({
  src,
  alt,
  size = 32,
  className = '',
  initials = '',
  ...props
}) {
  const [hasError, setHasError] = useState(false);

  const initialsStyle = {
    width: size,
    height: size,
    borderRadius: '50%',
    backgroundColor: 'var(--hub-primary)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: size * 0.4,
    fontWeight: 600,
  };

  if (!src || hasError) {
    return (
      <div style={initialsStyle} className={className}>
        {initials || '?'}
      </div>
    );
  }

  return (
    <LazyImage
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={{ borderRadius: '50%' }}
      onError={() => setHasError(true)}
      {...props}
    />
  );
});

export default LazyImage;
