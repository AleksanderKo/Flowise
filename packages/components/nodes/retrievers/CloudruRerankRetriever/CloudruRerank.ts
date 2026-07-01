import { Callbacks } from '@langchain/core/callbacks/manager'
import { Document } from '@langchain/core/documents'
import axios from 'axios'
import { BaseDocumentCompressor } from '@langchain/classic/retrievers/document_compressors'

/**
 * Reranker compressor for Cloud.ru Foundation Models (and other OpenAI-compatible
 * "/score" reranking endpoints, e.g. Qwen/Qwen3-Reranker-*).
 *
 * The endpoint scores each document against the query and returns
 * `{ data: [{ index, score }, ...] }` in the original document order.
 * Unlike Cohere/Jina it does not sort or apply top_n, so we do it here.
 */
export class CloudruRerank extends BaseDocumentCompressor {
    private readonly apiKey: string
    private readonly baseURL: string
    private readonly model: string
    private readonly topN: number

    constructor(apiKey: string, model: string, baseURL: string, topN: number) {
        super()
        this.apiKey = apiKey
        this.model = model
        this.baseURL = baseURL.replace(/\/+$/, '')
        this.topN = topN
    }

    async compressDocuments(
        documents: Document<Record<string, any>>[],
        query: string,
        _?: Callbacks | undefined
    ): Promise<Document<Record<string, any>>[]> {
        if (documents.length === 0) {
            return []
        }
        const config = {
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            }
        }
        const data = {
            model: this.model,
            encoding_format: 'float',
            text_1: query,
            text_2: documents.map((doc) => doc.pageContent)
        }
        const results = await axios.post(`${this.baseURL}/score`, data, config)
        const scored = results.data?.data ?? []
        const finalResults: Document<Record<string, any>>[] = scored
            .map((result: any) => {
                const doc = documents[result.index]
                if (!doc) return undefined
                doc.metadata.relevance_score = result.score
                return doc
            })
            .filter((doc: Document | undefined): doc is Document => doc !== undefined)
            .sort((a: Document, b: Document) => (b.metadata.relevance_score ?? 0) - (a.metadata.relevance_score ?? 0))

        return finalResults.slice(0, this.topN)
    }
}
