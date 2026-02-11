"use client";

import { useState, useEffect } from "react";

export function useLocalStorage<T>(key: string, initialValue: T) {
    // State to store our value
    // Pass initial state function to useState so logic is only executed once
    const [storedValue, setStoredValue] = useState<T>(initialValue);

    const [isHydrated, setIsHydrated] = useState(false);

    // Initialize from LocalStorage on mount
    useEffect(() => {
        try {
            const item = window.localStorage.getItem(key);
            if (item) {
                setStoredValue(JSON.parse(item));
            }
        } catch (error) {
            console.error(`Error reading localStorage key "${key}":`, error);
        }
        setIsHydrated(true);
    }, [key]);

    // Return a wrapped version of useState's setter function that
    // persists the new value to localStorage.
    const setValue = (value: T | ((val: T) => T)) => {
        try {
            // Allow value to be a function so we have same API as useState
            const valueToStore = value instanceof Function ? value(storedValue) : value;

            // Save state
            setStoredValue(valueToStore);

            // Save to local storage
            if (typeof window !== "undefined") {
                window.localStorage.setItem(key, JSON.stringify(valueToStore));

                // Dispatch a custom event so other instances of the hook in different components can sync
                window.dispatchEvent(new Event("local-storage-update"));
            }
        } catch (error) {
            console.error(`Error setting localStorage key "${key}":`, error);
        }
    };

    // Listen for updates from other tabs/components
    useEffect(() => {
        const handleUpdate = () => {
            try {
                const item = window.localStorage.getItem(key);
                if (item) {
                    setStoredValue(JSON.parse(item));
                }
            } catch (error) {
                console.error(`Error syncing localStorage key "${key}":`, error);
            }
        };

        window.addEventListener("local-storage-update", handleUpdate);
        window.addEventListener("storage", handleUpdate); // Also listen for cross-tab updates

        return () => {
            window.removeEventListener("local-storage-update", handleUpdate);
            window.removeEventListener("storage", handleUpdate);
        };
    }, [key]);

    return [storedValue, setValue, isHydrated] as const;
}
