"use client"

import { useCallback, useEffect, useState } from "react"
import { safeErrorMessage } from "@/lib/format"

export interface ApiResourceState<T> {
  data: T | null
  error: string | null
  loading: boolean
  refresh: () => Promise<void>
}

export function useApiResource<T>(loader: () => Promise<T>): ApiResourceState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await loader())
    } catch (requestError) {
      setError(safeErrorMessage(requestError))
    } finally {
      setLoading(false)
    }
  }, [loader])

  useEffect(() => {
    let ignored = false

    async function loadInitial() {
      try {
        const loaded = await loader()
        if (!ignored) {
          setData(loaded)
          setError(null)
        }
      } catch (requestError) {
        if (!ignored) {
          setError(safeErrorMessage(requestError))
        }
      } finally {
        if (!ignored) {
          setLoading(false)
        }
      }
    }

    void loadInitial()

    return () => {
      ignored = true
    }
  }, [loader])

  return { data, error, loading, refresh }
}
