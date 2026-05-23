"use client"

import { useCallback } from "react"
import { Button } from "@/components/ui/button"
import { dashboardApi, type UsageResponse } from "@/lib/api-client"
import { ErrorPanel, LoadingPanel } from "../data-state"
import { PageHeader } from "../page-header"
import { useApiResource } from "../use-api-resource"
import { UsageRecordsTable } from "./usage-page"

export function LogsPage() {
  const loader = useCallback(async (): Promise<UsageResponse> => dashboardApi.usage(200), [])
  const { data, error, loading, refresh } = useApiResource(loader)

  return (
    <>
      <PageHeader
        title="Logs"
        description="최근 요청 로그를 넓은 테이블로 확인합니다. 세부 trace 화면은 다음 단계에서 붙이면 좋습니다."
        actions={
          <Button type="button" variant="outline" onClick={() => void refresh()}>
            Refresh
          </Button>
        }
      />
      {loading ? <LoadingPanel /> : null}
      {error ? <ErrorPanel message={error} onRetry={() => void refresh()} /> : null}
      {data ? <UsageRecordsTable data={data} title="Request logs" /> : null}
    </>
  )
}
