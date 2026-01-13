"""Orchestrator Agent - Coordinates and delegates tasks to specialized agents."""

from typing import Any, Dict, List, Optional
from .base_agent import BaseAgent, AgentConfig, AgentResult, AgentState
import structlog


class OrchestratorAgentConfig(AgentConfig):
    """Configuration for the Orchestrator Agent."""
    max_delegations: int = 10
    available_agents: List[str] = []
    parallel_execution: bool = True
    retry_failed: bool = True


class OrchestratorAgent(BaseAgent):
    """Super Agent that coordinates other agents and manages workflows."""
    
    name = "orchestrator"
    
    def __init__(
        self,
        config: Optional[OrchestratorAgentConfig] = None,
        tools: Optional[List] = None,
        memory = None,
    ):
        super().__init__(tools=tools, memory=memory)
        self.config = config or OrchestratorAgentConfig(name="orchestrator")
        self._registered_agents: Dict[str, BaseAgent] = {}
        self._delegation_count = 0
    
    @property
    def description(self) -> str:
        return "Coordinates and delegates tasks to specialized agents, manages complex workflows"
    
    @property
    def category(self) -> str:
        return "orchestration"
    
    @property
    def tools_used(self) -> List[str]:
        return ["orchestrate", "plan", "reason", "message"]
    
    def get_system_prompt(self) -> str:
        return """You are the Orchestrator Agent, the central coordinator of the agent system.
Your role is to:
1. Analyze incoming tasks and break them into logical subtasks
2. Delegate subtasks to the most appropriate specialized agents
3. Coordinate parallel execution when tasks are independent
4. Synthesize results from multiple agents into coherent outputs
5. Handle errors gracefully and retry failed operations
6. Track progress and provide status updates

Available specialized agents:
- ResearchAgent: Web search, information gathering, data synthesis
- CodeAgent: Code generation, review, debugging, execution
- DataAgent: Data analysis, transformation, visualization
- ContentAgent: Text generation, editing, summarization
- CommunicationAgent: Messaging, notifications, email
- BrowserAgent: Web navigation, scraping, automation
- DocumentAgent: Document creation, parsing, conversion
- QAAgent: Testing, validation, quality assurance
- SecurityAgent: Security scanning, input validation, secrets

When delegating tasks:
- Match task requirements to agent capabilities
- Provide clear context and requirements
- Set appropriate timeouts and retry policies
- Aggregate and validate results before returning"""
    
    def register_agent(self, agent: BaseAgent) -> None:
        """Register a specialized agent for delegation."""
        self._registered_agents[agent.name] = agent
        self.logger.info("agent_registered", agent_name=agent.name)
    
    def get_registered_agents(self) -> List[str]:
        """Get list of registered agent names."""
        return list(self._registered_agents.keys())
    
    async def delegate(self, agent_name: str, task: str, context: Optional[Dict[str, Any]] = None) -> AgentResult:
        """Delegate a task to a specific agent."""
        if agent_name not in self._registered_agents:
            return AgentResult(
                success=False,
                error=f"Agent '{agent_name}' not registered"
            )
        
        if self._delegation_count >= self.config.max_delegations:
            return AgentResult(
                success=False,
                error="Maximum delegation limit reached"
            )
        
        self._delegation_count += 1
        agent = self._registered_agents[agent_name]
        
        try:
            result = await agent.execute(task, context)
            return result
        except Exception as e:
            self.logger.error("delegation_failed", agent=agent_name, error=str(e))
            if self.config.retry_failed:
                return await agent.execute(task, context)
            return AgentResult(success=False, error=str(e))
    
    async def run(self, task: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Execute the orchestrator's main loop."""
        self.state = AgentState.PLANNING
        context = context or {}
        
        plan = await self.plan(task, context)
        
        self.state = AgentState.EXECUTING
        results = []
        
        for step in plan:
            result = await self.execute_step(step, context)
            results.append(result)
        
        self.state = AgentState.COMPLETED
        return {"plan": plan, "results": results}
    
    async def plan(self, task: str, context: Dict[str, Any]) -> List[str]:
        """Generate an execution plan for the task."""
        return [f"Execute: {task}"]
    
    async def execute_step(self, step: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a single step of the plan."""
        self.logger.info("executing_step", step=step[:100])
        return {"step": step, "status": "completed"}
    
    async def execute(self, task: str, context: Optional[Dict[str, Any]] = None) -> AgentResult:
        """Execute a task by coordinating specialized agents."""
        self.logger.info("orchestrator_execute", task=task[:100] if task else "")
        self.state = AgentState.EXECUTING
        context = context or {}
        
        try:
            result = await self.run(task, context)
            self.state = AgentState.COMPLETED
            return AgentResult(
                success=True,
                data=result,
                metadata={"delegations": self._delegation_count}
            )
        except Exception as e:
            self.state = AgentState.ERROR
            self.logger.error("orchestrator_error", error=str(e))
            return AgentResult(success=False, error=str(e))
    
    async def initialize(self) -> None:
        """Initialize the orchestrator agent."""
        await super().initialize()
        self._delegation_count = 0
        self.logger.info("orchestrator_initialized", registered_agents=len(self._registered_agents))
    
    async def shutdown(self) -> None:
        """Shutdown the orchestrator agent."""
        for agent in self._registered_agents.values():
            await agent.shutdown()
        await super().shutdown()
        self.logger.info("orchestrator_shutdown")
