import { IComponentNodes, IComponentCredentials } from './Interface'
import path from 'path'
import { Dirent, existsSync } from 'fs'
import { getNodeModulesPackagePath } from './utils'
import { promises } from 'fs'
import { ICommonObject } from 'flowise-components'
import logger from './utils/logger'
import { appConfig } from './AppConfig'
import { pathToFileURL } from 'url'

export class NodesPool {
    componentNodes: IComponentNodes = {}
    componentCredentials: IComponentCredentials = {}
    private credentialIconPath: ICommonObject = {}

    /**
     * Initialize to get all nodes & credentials
     */
    async initialize() {
        await this.initializeNodes()
        await this.initializeCredentials()
    }

    /**
     * Initialize nodes
     */
    private async initializeNodes() {
        const disabled_nodes = process.env.DISABLED_NODES ? process.env.DISABLED_NODES.split(',') : []
        const packagePath = getNodeModulesPackagePath('flowise-components')
        const distNodesPath = path.join(packagePath, 'dist', 'nodes')
        const sourceNodesPath = path.join(packagePath, 'nodes')
        const nodesPath = existsSync(distNodesPath) ? distNodesPath : sourceNodesPath
        if (!existsSync(nodesPath)) {
            logger.error(`❌ [server]: Flowise nodes path not found: ${nodesPath}`)
            return []
        }
        const nodeFiles = await this.getFiles(nodesPath)
        return Promise.all(
            nodeFiles.map(async (file) => {
                if (
                    (file.endsWith('.js') || file.endsWith('.cjs') || file.endsWith('.mjs') || file.endsWith('.ts')) &&
                    !file.endsWith('.d.ts')
                ) {
                    try {
                        let nodeModule: any
                        try {
                            nodeModule = await import(pathToFileURL(file).href)
                        } catch {
                            // fallback for legacy require paths
                            // eslint-disable-next-line @typescript-eslint/no-var-requires
                            nodeModule = require(file)
                        }

                        const resolvedModule = nodeModule?.nodeClass ? nodeModule : nodeModule?.default || nodeModule

                        if (resolvedModule?.nodeClass) {
                            const newNodeInstance = new resolvedModule.nodeClass()
                            newNodeInstance.filePath = file

                            // Replace file icon with absolute path
                            if (
                                newNodeInstance.icon &&
                                (newNodeInstance.icon.endsWith('.svg') ||
                                    newNodeInstance.icon.endsWith('.png') ||
                                    newNodeInstance.icon.endsWith('.jpg'))
                            ) {
                                const filePath = file.replace(/\\/g, '/').split('/')
                                filePath.pop()
                                const nodeIconAbsolutePath = `${filePath.join('/')}/${newNodeInstance.icon}`
                                newNodeInstance.icon = nodeIconAbsolutePath

                                // Store icon path for componentCredentials
                                if (newNodeInstance.credential) {
                                    for (const credName of newNodeInstance.credential.credentialNames) {
                                        this.credentialIconPath[credName] = nodeIconAbsolutePath
                                    }
                                }
                            }

                            const skipCategories = ['Analytic', 'SpeechToText']
                            const conditionOne = !skipCategories.includes(newNodeInstance.category)

                            const isCommunityNodesAllowed = appConfig.showCommunityNodes
                            const isAuthorPresent = newNodeInstance.author
                            let conditionTwo = true
                            if (!isCommunityNodesAllowed && isAuthorPresent) conditionTwo = false

                            const isDisabled = disabled_nodes.includes(newNodeInstance.name)

                            if (conditionOne && conditionTwo && !isDisabled) {
                                this.componentNodes[newNodeInstance.name] = newNodeInstance
                            }
                        }
                    } catch (err) {
                        logger.error(`❌ [server]: Error during initDatabase with file ${file}:`, err)
                    }
                }
            })
        )
    }

    /**
     * Initialize credentials
     */
    private async initializeCredentials() {
        const packagePath = getNodeModulesPackagePath('flowise-components')
        const distCredsPath = path.join(packagePath, 'dist', 'credentials')
        const sourceCredsPath = path.join(packagePath, 'credentials')
        const nodesPath = existsSync(distCredsPath) ? distCredsPath : sourceCredsPath
        if (!existsSync(nodesPath)) {
            return []
        }
        const nodeFiles = await this.getFiles(nodesPath)
        return Promise.all(
            nodeFiles.map(async (file) => {
                if (
                    (file.endsWith('.credential.js') ||
                        file.endsWith('.credential.cjs') ||
                        file.endsWith('.credential.mjs') ||
                        file.endsWith('.credential.ts')) &&
                    !file.endsWith('.d.ts')
                ) {
                    let credentialModule: any
                    try {
                        credentialModule = await import(pathToFileURL(file).href)
                    } catch {
                        // eslint-disable-next-line @typescript-eslint/no-var-requires
                        credentialModule = require(file)
                    }
                    const resolvedModule = credentialModule?.credClass
                        ? credentialModule
                        : credentialModule?.default || credentialModule
                    if (resolvedModule?.credClass) {
                        const newCredInstance = new resolvedModule.credClass()
                        newCredInstance.icon = this.credentialIconPath[newCredInstance.name] ?? ''
                        this.componentCredentials[newCredInstance.name] = newCredInstance
                    }
                }
            })
        )
    }

    /**
     * Recursive function to get node files
     * @param {string} dir
     * @returns {string[]}
     */
    private async getFiles(dir: string): Promise<string[]> {
        const dirents = await promises.readdir(dir, { withFileTypes: true })
        const files = await Promise.all(
            dirents.map((dirent: Dirent) => {
                const res = path.resolve(dir, dirent.name)
                return dirent.isDirectory() ? this.getFiles(res) : res
            })
        )
        return Array.prototype.concat(...files)
    }
}
