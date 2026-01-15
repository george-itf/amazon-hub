import React, { createContext, useContext, useState, useCallback } from 'react';

/**
 * Context for global product detail modal
 * Can be triggered from anywhere in the app to show product/BOM details
 */
const ProductModalContext = createContext(null);

export function ProductModalProvider({ children }) {
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [isOpen, setIsOpen] = useState(false);

  const openProductModal = useCallback((product) => {
    // Product can be: { bom_id, bom_sku, title, asin, sku, ... }
    setSelectedProduct(product);
    setIsOpen(true);
  }, []);

  const closeProductModal = useCallback(() => {
    setIsOpen(false);
    // Delay clearing product to allow close animation
    setTimeout(() => setSelectedProduct(null), 200);
  }, []);

  return (
    <ProductModalContext.Provider
      value={{
        selectedProduct,
        isOpen,
        openProductModal,
        closeProductModal,
      }}
    >
      {children}
    </ProductModalContext.Provider>
  );
}

export function useProductModal() {
  const context = useContext(ProductModalContext);
  if (!context) {
    throw new Error('useProductModal must be used within a ProductModalProvider');
  }
  return context;
}
